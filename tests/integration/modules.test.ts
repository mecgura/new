import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import * as postsRoute from "@/app/api/organizations/[orgId]/social/posts/route";
import * as postRoute from "@/app/api/organizations/[orgId]/social/posts/[postId]/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/social/posts/[postId]/publish/route";
import * as postedRoute from "@/app/api/organizations/[orgId]/social/posts/[postId]/posted/route";
import * as mediaRoute from "@/app/api/social-media/[key]/route";
import { runDueSocialPosts } from "@/services/social/posts";

afterEach(() => vi.restoreAllMocks());

let n = 0;
const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
async function workspace(services: string[]) {
  const org = await makeOrg(`Module Biz ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, agent.id, "AGENT");
  for (const s of services) await db.organizationService.create({ data: { organizationId: org.id, service: s, enabled: true } });
  const P = <E extends Record<string, string> = Record<never, string>>(extra?: E) => params({ orgId: org.id, ...(extra ?? ({} as E)) });
  return { org, owner, agent, P };
}
const body = (method: string, b: unknown) => req("/x", { method, body: b });

describe("social media", () => {
  it("is locked until the service is on, and only for owners and managers", async () => {
    const off = await workspace([]);
    actAs(off.owner);
    expect((await postsRoute.POST(body("POST", { caption: "Hi", channels: ["facebook"] }), off.P())).status).toBe(403);
    const on = await workspace(["SOCIAL_MEDIA"]);
    actAs(on.agent);
    expect((await postsRoute.POST(body("POST", { caption: "Hi", channels: ["facebook"] }), on.P())).status).toBe(403);
  });

  it("plans, schedules, publishes to the Facebook Page and records posts made by hand", async () => {
    const w = await workspace(["SOCIAL_MEDIA"]);
    actAs(w.owner);
    // Instagram needs an image; scheduling needs a future time.
    expect((await postsRoute.POST(body("POST", { caption: "Hello", channels: ["instagram"] }), w.P())).status).toBe(400);
    expect((await postsRoute.POST(body("POST", { caption: "Hello", channels: ["facebook"], status: "scheduled", scheduledAt: new Date(Date.now() - 3_600_000).toISOString() }), w.P())).status).toBe(400);

    const d = await json(await postsRoute.POST(body("POST", { caption: "Diwali sale!", channels: ["facebook", "instagram"], image: IMG }), w.P()));
    expect(d.status).toBe(201);
    const post = d.body.post as { id: string; imageUrl: string; status: string };
    expect(post.status).toBe("draft");
    const key = post.imageUrl.split("/").pop()!.split("?")[0];
    expect((await mediaRoute.GET(req("/x"), { params: Promise.resolve({ key }) })).headers.get("content-type")).toBe("image/png");

    // No connected accounts: publishing fails with a clear reason, and it can be marked as posted by hand.
    const failed = await json(await publishRoute.POST(body("POST", {}), w.P({ postId: post.id })));
    expect((failed.body.post as { status: string }).status).toBe("failed");
    const manual = await json(await postedRoute.POST(body("POST", {}), w.P({ postId: post.id })));
    expect((manual.body.post as { status: string }).status).toBe("published");
    expect((await postRoute.PUT(body("PUT", { caption: "x", channels: ["facebook"] }), w.P({ postId: post.id }))).status).toBe(409);

    // With the Page connected, a scheduled post goes out when its time comes.
    await db.channelAccount.create({ data: { organizationId: w.org.id, kind: "messenger", name: "Shop Page", address: `page${n}`, encryptedToken: encryptSecret("EAAtoken"), publicKey: `pk${Date.now()}${n}`, status: "active" } });
    const s = await json(await postsRoute.POST(body("POST", { caption: "Weekend offer", channels: ["facebook"], status: "scheduled", scheduledAt: new Date(Date.now() + 60_000).toISOString() }), w.P()));
    const sid = (s.body.post as { id: string }).id;
    await db.socialPost.update({ where: { id: sid }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "page_123" }), { status: 200 }));
    const r = await runDueSocialPosts();
    expect(r.published).toBeGreaterThanOrEqual(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/feed");
    const after = await db.socialPost.findUniqueOrThrow({ where: { id: sid } });
    expect(after.status).toBe("published");
    expect(JSON.parse(after.results).facebook.id).toBe("page_123");
  });
});
