import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ create: null as unknown as ReturnType<typeof import("vitest").vi.fn> }));
vi.mock("@anthropic-ai/sdk", async () => {
  const { vi: v } = await import("vitest");
  sdk.create = v.fn();
  class APIError extends Error {}
  class Anthropic {
    static APIError = APIError;
    beta = { messages: { create: (...a: unknown[]) => sdk.create(...a) } };
  }
  return { default: Anthropic };
});

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import * as postsRoute from "@/app/api/organizations/[orgId]/social/posts/route";
import * as postRoute from "@/app/api/organizations/[orgId]/social/posts/[postId]/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/social/posts/[postId]/publish/route";
import * as postedRoute from "@/app/api/organizations/[orgId]/social/posts/[postId]/posted/route";
import * as approveRoute from "@/app/api/organizations/[orgId]/social/posts/[postId]/approve/route";
import * as changesRoute from "@/app/api/organizations/[orgId]/social/posts/[postId]/request-changes/route";
import * as settingsRoute from "@/app/api/organizations/[orgId]/social/settings/route";
import * as assetsRoute from "@/app/api/organizations/[orgId]/social/assets/route";
import * as assetRoute from "@/app/api/organizations/[orgId]/social/assets/[assetId]/route";
import * as assetFileRoute from "@/app/api/organizations/[orgId]/social/assets/[assetId]/file/route";
import * as captionsRoute from "@/app/api/organizations/[orgId]/social/ai/captions/route";
import { runDueSocialPosts } from "@/services/social/posts";

afterEach(() => {
  vi.unstubAllEnvs();
  sdk.create.mockReset();
});

let n = 0;
const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const body = (method: string, b: unknown) => req("/x", { method, body: b });
const future = () => new Date(Date.now() + 2 * 86_400_000).toISOString();

async function workspace() {
  const org = await makeOrg(`Social Biz ${n++}`);
  const [owner, manager] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Manager" })]);
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await db.organizationService.create({ data: { organizationId: org.id, service: "SOCIAL_MEDIA", enabled: true } });
  const P = <E extends Record<string, string> = Record<never, string>>(extra?: E) => params({ orgId: org.id, ...(extra ?? ({} as E)) });
  return { org, owner, manager, P };
}

describe("social approvals", () => {
  it("only the owner turns approval on or off", async () => {
    const w = await workspace();
    actAs(w.manager);
    expect((await settingsRoute.PUT(body("PUT", { requireApproval: true }), w.P())).status).toBe(403);
    expect((await settingsRoute.PUT(body("PUT", { requireApproval: false, brandVoice: "Warm, simple Hinglish" }), w.P())).status).toBe(200);
    actAs(w.owner);
    const r = await json(await settingsRoute.PUT(body("PUT", { requireApproval: true, brandVoice: "Warm, simple Hinglish" }), w.P()));
    expect(r.body.settings).toMatchObject({ requireApproval: true, brandVoice: "Warm, simple Hinglish" });
  });

  it("a manager's scheduled post waits for the owner, who can ask for changes or approve", async () => {
    const w = await workspace();
    actAs(w.owner);
    await settingsRoute.PUT(body("PUT", { requireApproval: true }), w.P());

    actAs(w.manager);
    const c = await json(await postsRoute.POST(body("POST", { caption: "Lohri special: gajak ₹299", channels: ["facebook"], status: "scheduled", scheduledAt: future() }), w.P()));
    const post = c.body.post as { id: string; status: string };
    expect(post.status).toBe("pending_approval");
    expect(await db.notification.count({ where: { userId: w.owner.id, title: { contains: "needs your approval" } } })).toBe(1);
    // The manager can't approve, publish or mark it posted.
    expect((await approveRoute.POST(body("POST", {}), w.P({ postId: post.id }))).status).toBe(403);
    expect((await publishRoute.POST(body("POST", {}), w.P({ postId: post.id }))).status).toBe(403);
    expect((await postedRoute.POST(body("POST", {}), w.P({ postId: post.id }))).status).toBe(403);
    // Not published by the scheduler either.
    await db.socialPost.update({ where: { id: post.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await runDueSocialPosts();
    expect((await db.socialPost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("pending_approval");
    await db.socialPost.update({ where: { id: post.id }, data: { scheduledAt: new Date(future()) } });

    actAs(w.owner);
    expect((await changesRoute.POST(body("POST", { note: "" }), w.P({ postId: post.id }))).status).toBe(400);
    const ch = await json(await changesRoute.POST(body("POST", { note: "Price is ₹349 now" }), w.P({ postId: post.id })));
    expect(ch.body.post).toMatchObject({ status: "changes_requested", reviewNote: "Price is ₹349 now" });
    expect(await db.notification.count({ where: { userId: w.manager.id, title: { contains: "Changes requested" } } })).toBe(1);

    actAs(w.manager);
    const edited = await json(await postRoute.PUT(body("PUT", { caption: "Lohri special: gajak ₹349", channels: ["facebook"], status: "scheduled", scheduledAt: future() }), w.P({ postId: post.id })));
    expect(edited.body.post).toMatchObject({ status: "pending_approval", reviewNote: "" });

    actAs(w.owner);
    const ap = await json(await approveRoute.POST(body("POST", {}), w.P({ postId: post.id })));
    expect(ap.body.post).toMatchObject({ status: "scheduled" });
    expect((await approveRoute.POST(body("POST", {}), w.P({ postId: post.id }))).status).toBe(409);

    // Editing an approved post sends it back for approval.
    actAs(w.manager);
    const again = await json(await postRoute.PUT(body("PUT", { caption: "Lohri special: gajak ₹349 🔥", channels: ["facebook"], status: "scheduled", scheduledAt: future() }), w.P({ postId: post.id })));
    expect(again.body.post).toMatchObject({ status: "pending_approval", approvedAt: null });

    // The owner's own posts don't wait.
    actAs(w.owner);
    const own = await json(await postsRoute.POST(body("POST", { caption: "Owner post", channels: ["facebook"], status: "scheduled", scheduledAt: future() }), w.P()));
    expect((own.body.post as { status: string; approvedAt: string | null })).toMatchObject({ status: "scheduled" });
    expect((own.body.post as { approvedAt: string | null }).approvedAt).not.toBeNull();
  });

  it("holds posts scheduled before approval was switched on", async () => {
    const w = await workspace();
    actAs(w.manager);
    const c = await json(await postsRoute.POST(body("POST", { caption: "Old plan", channels: ["facebook"], status: "scheduled", scheduledAt: future() }), w.P()));
    const id = (c.body.post as { id: string }).id;
    actAs(w.owner);
    await settingsRoute.PUT(body("PUT", { requireApproval: true }), w.P());
    await db.socialPost.update({ where: { id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await runDueSocialPosts();
    expect((await db.socialPost.findUniqueOrThrow({ where: { id } })).status).toBe("pending_approval");
  });
});

describe("media library", () => {
  it("stores images once and uses them in posts; other workspaces can't see them", async () => {
    const w = await workspace();
    actAs(w.manager);
    expect((await assetsRoute.POST(body("POST", { name: "x", image: "data:image/gif;base64,R0lG" }), w.P())).status).toBe(400);
    const a = await json(await assetsRoute.POST(body("POST", { name: "Logo", image: IMG, tags: "logo, brand" }), w.P()));
    expect(a.status).toBe(201);
    const asset = a.body.asset as { id: string; tags: string };
    expect(asset.tags).toBe("logo brand");
    const list = await json(await assetsRoute.GET(req("/x?q=brand"), w.P()));
    expect((list.body.assets as { id: string }[]).map((x) => x.id)).toEqual([asset.id]);
    const file = await assetFileRoute.GET(req("/x"), w.P({ assetId: asset.id }));
    expect(file.headers.get("content-type")).toBe("image/png");

    const p = await json(await postsRoute.POST(body("POST", { caption: "With logo", channels: ["instagram"], assetId: asset.id }), w.P()));
    expect(p.status).toBe(201);
    expect(p.body.post).toMatchObject({ hasImage: true });

    const other = await workspace();
    actAs(other.owner);
    expect((await postsRoute.POST(body("POST", { caption: "steal", channels: ["instagram"], assetId: asset.id }), other.P())).status).toBe(404);
    expect((await assetFileRoute.GET(req("/x"), other.P({ assetId: asset.id }))).status).toBe(404);
    expect((await assetRoute.DELETE(body("DELETE", {}), other.P({ assetId: asset.id }))).status).toBe(404);
    actAs(w.manager);
    expect((await assetRoute.DELETE(body("DELETE", {}), w.P({ assetId: asset.id }))).status).toBe(200);
    // The post keeps its own copy.
    expect((await db.socialPost.findUniqueOrThrow({ where: { id: (p.body.post as { id: string }).id } })).mediaType).toBe("image/png");
  });
});

describe("AI captions", () => {
  it("says configuration is required without a key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const w = await workspace();
    actAs(w.manager);
    const r = await json(await captionsRoute.POST(body("POST", { brief: "Lohri gajak boxes at ₹299, order on WhatsApp" }), w.P()));
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toContain("Configuration required");
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it("returns three options with clean hashtags, using the brand voice and default tags", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    const w = await workspace();
    actAs(w.owner);
    await settingsRoute.PUT(body("PUT", { requireApproval: false, brandVoice: "Family sweet shop since 1985", defaultHashtags: "#SharmaSweets" }), w.P());
    sdk.create.mockResolvedValue({
      stop_reason: "end_turn",
      model: "claude-haiku-5-5",
      usage: { input_tokens: 300, output_tokens: 200 },
      content: [{ type: "text", text: JSON.stringify({ options: [
        { caption: "Lohri di mithaas 🔥\nGajak boxes ₹299.\nWhatsApp karo!", hashtags: ["SharmaSweets", "#Lohri 2027", "#Gajak", "#Gajak"] },
        { caption: "Option two", hashtags: ["#Ludhiana"] },
        { caption: "Option three", hashtags: [] },
      ] }) }],
    });
    const r = await json(await captionsRoute.POST(body("POST", { brief: "Lohri gajak boxes at ₹299, order on WhatsApp", language: "pa-roman", tone: "festive", platform: "instagram" }), w.P()));
    expect(r.status).toBe(200);
    const options = r.body.options as { caption: string; hashtags: string[] }[];
    expect(options).toHaveLength(3);
    expect(options[0].hashtags).toEqual(["#SharmaSweets", "#Lohri2027", "#Gajak"]);
    const sent = sdk.create.mock.calls[0][0] as { system: string; messages: { content: string }[] };
    expect(sent.system).toContain("Punjabi in Roman letters");
    expect(sent.system).toContain("Family sweet shop since 1985");
    expect(sent.system).toContain("#SharmaSweets");
    expect(sent.system).toContain("Never invent discounts");
    expect(sent.messages[0].content).toContain("₹299");

    sdk.create.mockResolvedValue({ stop_reason: "end_turn", model: "m", usage: {}, content: [{ type: "text", text: "not json" }] });
    expect((await captionsRoute.POST(body("POST", { brief: "Lohri gajak boxes at ₹299, order on WhatsApp" }), w.P())).status).toBe(503);
  });
});
