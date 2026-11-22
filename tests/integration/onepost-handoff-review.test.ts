import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, req } from "../helpers";
import * as postsRoute from "@/app/api/organizations/[orgId]/onepost/posts/route";
import * as postRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/route";
import * as generateRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/generate/route";
import * as statusRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/status/route";
import * as versionRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/versions/[channel]/route";
import * as mediaRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/route";
import * as handoffRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/handoff/whatsapp/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/publish/route";
import * as linksRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/review-links/route";
import * as linkRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/review-links/[linkId]/route";
import * as publicRoute from "@/app/api/onepost-review/[token]/route";
import * as publicMedia from "@/app/api/onepost-review/[token]/media/[mediaId]/route";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import { sha256 } from "@/lib/crypto";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ctx = <X extends Record<string, string>>(p: X) => ({ params: Promise.resolve(p) });
const body = (b: unknown, method = "POST") => req("/x", { method, body: b });
beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

let n = 0;
async function tenant(opts: { whatsapp?: boolean } = {}) {
  const org = await makeOrg(`Review ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const manager = await makeUser({ name: "Manager" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent.id, "AGENT");
  await db.organizationService.create({ data: { organizationId: org.id, service: "ONEPOST", enabled: true } });
  if (opts.whatsapp) {
    const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
    await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
    await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
    actAs(owner);
    expect((await json(await demoConnect.POST(body({ businessName: "Clinic" }), ctx({ orgId: org.id })))).status).toBe(201);
  }
  return { org, owner, manager, agent, O: { orgId: org.id } };
}
type T = Awaited<ReturnType<typeof tenant>>;
const P = <E extends Record<string, string> = Record<never, never>>(t: T, postId: string, extra?: E) => ctx({ ...t.O, postId, ...(extra as E) });

async function post(t: T, state: "draft" | "in_review" | "approved", photo = false) {
  actAs(t.owner);
  const id = ((await json(await postsRoute.POST(body({ title: "Winter wellness camp", brief: "Free BP check on 5 December at our Shimla clinic.", city: "Shimla" }), ctx(t.O)))).body.post as { id: string }).id;
  if (photo) await mediaRoute.POST(body({ name: "a.png", image: PNG }), P(t, id));
  await generateRoute.POST(body({}), P(t, id));
  if (state === "in_review") await statusRoute.POST(body({ action: "submit" }), P(t, id));
  if (state === "approved") await statusRoute.POST(body({ action: "approve" }), P(t, id));
  return id;
}

describe("WhatsApp hand-off to the existing Templates system", () => {
  it("creates only a DRAFT template from the approved text; nothing is submitted or sent", async () => {
    const t = await tenant({ whatsapp: true });
    const id = await post(t, "approved");
    actAs(t.manager);
    const r = await json(await handoffRoute.POST(body({}), P(t, id)));
    expect(r.status).toBe(201);
    const tpl = await db.messageTemplate.findFirstOrThrow({ where: { organizationId: t.org.id, name: { startsWith: "onepost_winter_wellness_camp_" } } });
    expect(tpl.status).toBe("draft");
    expect(tpl.metaTemplateId ?? "").toBe("");
    expect(["MARKETING", "UTILITY"]).toContain(tpl.category);
    expect(tpl.body).toMatch(/Winter wellness camp|BP check/);
    expect(tpl.body).not.toMatch(/^\{\{/);
    expect(r.body.url).toBe(`/templates/${tpl.id}`);
    expect(await db.campaign.count({ where: { organizationId: t.org.id } })).toBe(0);
    expect(await db.message.count({ where: { organizationId: t.org.id } })).toBe(0);
    const opts = await json(await publishRoute.GET(req("/x"), P(t, id)));
    expect((opts.body.handoffs as { id: string }[])[0].id).toBe(tpl.id);
  });

  it("needs an approved post, a connected number, the right role and the WhatsApp service", async () => {
    const t = await tenant({ whatsapp: true });
    const draft = await post(t, "draft");
    expect((await json(await handoffRoute.POST(body({}), P(t, draft)))).status).toBe(409);
    const id = await post(t, "approved");
    actAs(t.agent);
    expect((await json(await handoffRoute.POST(body({}), P(t, id)))).status).toBe(403);
    const none = await tenant();
    const id2 = await post(none, "approved");
    actAs(none.owner);
    expect((await json(await handoffRoute.POST(body({}), P(none, id2)))).status).toBe(403); // WhatsApp service is off
  });
});

describe("Client review link: no login, expiring, tied to the exact content", () => {
  it("is made only for a post that is waiting for review, by owners and managers; the address is stored only as a hash", async () => {
    const t = await tenant();
    const draft = await post(t, "draft");
    actAs(t.owner);
    expect((await json(await linksRoute.POST(body({ days: 7 }), P(t, draft)))).status).toBe(409);
    const id = await post(t, "in_review");
    actAs(t.agent);
    expect((await json(await linksRoute.POST(body({ days: 7 }), P(t, id)))).status).toBe(403);
    actAs(t.manager);
    const r = await json(await linksRoute.POST(body({ days: 3 }), P(t, id)));
    expect(r.status).toBe(201);
    const url = String((r.body.link as { url: string }).url);
    const token = url.split("/review/")[1];
    expect(token.length).toBeGreaterThan(40);
    const row = await db.onePostApprovalLink.findFirstOrThrow({ where: { postId: id } });
    expect(row.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(Math.round((row.expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(3);
    expect((await json(await linksRoute.POST(body({ days: 99 }), P(t, id)))).status).toBe(400);
    const list = await json(await linksRoute.GET(req("/x"), P(t, id)));
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect((list.body.links as { status: string }[])[0].status).toBe("active");
  });

  it("shows the client every version and approves, recording who, with no session at all", async () => {
    const t = await tenant();
    const id = await post(t, "in_review", true);
    actAs(t.owner);
    const token = String(((await json(await linksRoute.POST(body({ days: 7 }), P(t, id)))).body.link as { url: string }).url).split("/review/")[1];
    actAs(null);
    const view = await json(await publicRoute.GET(req("/x"), ctx({ token })));
    expect(view.status).toBe(200);
    expect(view.body.state).toBe("ok");
    expect((view.body.versions as unknown[]).length).toBe(10);
    expect(JSON.stringify(view.body)).not.toMatch(/organizationId|encrypted|token/i);
    const mediaId = (view.body.media as { id: string }[])[0].id;
    expect((await publicMedia.GET(req("/x"), ctx({ token, mediaId }))).status).toBe(200);

    expect((await json(await publicRoute.POST(body({ decision: "approved", name: "" }), ctx({ token })))).status).toBe(400);
    const ok = await json(await publicRoute.POST(body({ decision: "approved", name: "Mrs Mehta" }), ctx({ token })));
    expect(ok.status).toBe(200);
    const p = await db.onePost.findUniqueOrThrow({ where: { id } });
    expect(p.status).toBe("approved");
    expect(p.approvedById).toBeNull();
    const ev = await db.onePostEvent.findFirstOrThrow({ where: { postId: id, action: "client_approved" } });
    expect(ev.actorUserId).toBeNull();
    expect(ev.note).toContain("Mrs Mehta");
    expect(await db.notification.count({ where: { userId: t.owner.id } })).toBeGreaterThan(0);
    // The link is spent.
    expect((await json(await publicRoute.POST(body({ decision: "approved", name: "Mrs Mehta" }), ctx({ token })))).status).toBe(409);
    expect((await json(await publicRoute.GET(req("/x"), ctx({ token })))).body.state).toBe("decided");
    expect((await publicMedia.GET(req("/x"), ctx({ token, mediaId }))).status).toBe(404);
  });

  it("requested changes need a comment and send the post back with the note", async () => {
    const t = await tenant();
    const id = await post(t, "in_review");
    actAs(t.owner);
    const token = String(((await json(await linksRoute.POST(body({ days: 7 }), P(t, id)))).body.link as { url: string }).url).split("/review/")[1];
    actAs(null);
    expect((await json(await publicRoute.POST(body({ decision: "changes_requested", name: "Mrs Mehta" }), ctx({ token })))).status).toBe(400);
    expect((await json(await publicRoute.POST(body({ decision: "changes_requested", name: "Mrs Mehta", note: "Add our timings" }), ctx({ token })))).status).toBe(200);
    const p = await db.onePost.findUniqueOrThrow({ where: { id } });
    expect(p.status).toBe("changes_requested");
    expect(p.reviewNote).toBe("Mrs Mehta: Add our timings");
  });

  it("stops working when the post changes, when it expires, when revoked, or for a made-up link", async () => {
    const t = await tenant();
    const mk = async () => {
      const id = await post(t, "in_review");
      actAs(t.owner);
      const l = (await json(await linksRoute.POST(body({ days: 7 }), P(t, id)))).body.link as { id: string; url: string };
      return { id, linkId: l.id, token: l.url.split("/review/")[1] };
    };
    const state = async (token: string) => (await json(await publicRoute.GET(req("/x"), ctx({ token })))).body.state;

    const changed = await mk();
    actAs(t.owner);
    await versionRoute.PUT(body({ content: { caption: "Changed after the link was sent", hashtags: ["x"] } }, "PUT"), P(t, changed.id, { channel: "instagram" }));
    actAs(null);
    expect(await state(changed.token)).toBe("stale");
    expect((await json(await publicRoute.POST(body({ decision: "approved", name: "Someone" }), ctx({ token: changed.token })))).status).toBe(409);
    expect((await db.onePost.findUniqueOrThrow({ where: { id: changed.id } })).status).toBe("draft");

    const expired = await mk();
    await db.onePostApprovalLink.updateMany({ where: { postId: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    actAs(null);
    expect(await state(expired.token)).toBe("expired");

    const revoked = await mk();
    actAs(t.manager);
    expect((await json(await linkRoute.DELETE(req("/x", { method: "DELETE" }), P(t, revoked.id, { linkId: revoked.linkId })))).status).toBe(200);
    actAs(null);
    expect(await state(revoked.token)).toBe("revoked");

    expect(await state("x".repeat(43))).toBe("invalid");
    expect(await state("short")).toBe("invalid");
    expect((await db.onePost.count({ where: { id: { in: [expired.id, revoked.id] }, status: "approved" } }))).toBe(0);
  });

  it("another workspace can't list or revoke a link, and a link only opens its own post's files", async () => {
    const a = await tenant();
    const b = await tenant();
    const idA = await post(a, "in_review", true);
    const idB = await post(b, "in_review", true);
    actAs(a.owner);
    const la = (await json(await linksRoute.POST(body({ days: 7 }), P(a, idA)))).body.link as { id: string; url: string };
    const tokenA = la.url.split("/review/")[1];
    actAs(b.owner);
    expect((await json(await linksRoute.GET(req("/x"), P(b, idA)))).status).toBe(404);
    expect((await json(await linkRoute.DELETE(req("/x", { method: "DELETE" }), P(b, idA, { linkId: la.id })))).status).toBe(404);
    const mediaB = (await db.onePostMedia.findFirstOrThrow({ where: { postId: idB } })).id;
    actAs(null);
    expect((await publicMedia.GET(req("/x"), ctx({ token: tokenA, mediaId: mediaB }))).status).toBe(404);
    void postRoute;
  });
});
