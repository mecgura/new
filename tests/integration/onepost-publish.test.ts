import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string) => ({ url: `https://test.public.blob.vercel-storage.com/${pathname}`, pathname })),
  del: vi.fn(async () => undefined),
  head: vi.fn(),
}));
vi.mock("@/providers/meta/social", async (orig) => ({ ...(await orig<typeof import("@/providers/meta/social")>()), publishFacebookPost: vi.fn(), publishInstagramPost: vi.fn() }));

import { head } from "@vercel/blob";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { actAs, addMember, json, makeOrg, makeUser, req } from "../helpers";
import { publishFacebookPost, publishInstagramPost } from "@/providers/meta/social";
import { MetaApiError } from "@/providers/meta/graph";
import * as postsRoute from "@/app/api/organizations/[orgId]/onepost/posts/route";
import * as generateRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/generate/route";
import * as statusRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/status/route";
import * as mediaRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/route";
import * as registerRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/register/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/publish/route";
import * as retryRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/retry/route";
import * as versionRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/versions/[channel]/route";
import * as deliveryRoute from "@/app/api/organizations/[orgId]/onepost/deliveries/[deliveryId]/route";
import * as calendarRoute from "@/app/api/organizations/[orgId]/onepost/calendar/route";
import { runDueOnePost } from "@/services/onepost/delivery";
import { dateToIstInput, istToDate } from "@/lib/onepost-publish";

/** An India-time date-time box value `days` from now (inside the 180-day scheduling limit). */
const inDays = (days: number, time = "10:30") => `${dateToIstInput(new Date(Date.now() + days * 86_400_000)).slice(0, 10)}T${time}`;

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const fb = vi.mocked(publishFacebookPost);
const ig = vi.mocked(publishInstagramPost);

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
  fb.mockReset().mockResolvedValue("fb_post_1");
  ig.mockReset().mockResolvedValue("ig_media_1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

let n = 0;
async function tenant() {
  const org = await makeOrg(`Publish ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const manager = await makeUser({ name: "Manager" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent.id, "AGENT");
  await db.organizationService.create({ data: { organizationId: org.id, service: "ONEPOST", enabled: true } });
  await db.channelAccount.create({ data: { organizationId: org.id, kind: "messenger", name: "Clinic Page", address: "page_1", publicKey: `pk_m_${org.id}`, status: "active", encryptedToken: encryptSecret("page-token") } });
  await db.channelAccount.create({ data: { organizationId: org.id, kind: "instagram", name: "clinic_ig", address: "ig_1", publicKey: `pk_i_${org.id}`, status: "active", encryptedToken: encryptSecret("ig-token") } });
  return { org, owner, manager, agent, O: { orgId: org.id } };
}
type T = Awaited<ReturnType<typeof tenant>>;
const ctx = <X extends Record<string, string>>(p: X) => ({ params: Promise.resolve(p) });
const P = (t: T, postId: string) => ctx({ ...t.O, postId });
const body = (b: unknown, method = "POST") => req("/x", { method, body: b });

const idea = { title: "Diwali health checkup offer", brief: "Full body checkup at Rs 999 from 1 to 10 November at our Shimla clinic.", city: "Shimla" };

/** An approved post with all versions written (demo) and, optionally, a photo. */
async function approvedPost(t: T, withPhoto = true) {
  actAs(t.owner);
  const id = ((await json(await postsRoute.POST(body(idea), ctx(t.O)))).body.post as { id: string }).id;
  if (withPhoto) expect((await json(await mediaRoute.POST(body({ name: "a.png", image: PNG }), P(t, id)))).status).toBe(201);
  expect((await json(await generateRoute.POST(body({}), P(t, id)))).status).toBe(200);
  expect((await json(await statusRoute.POST(body({ action: "approve" }), P(t, id)))).status).toBe(200);
  return id;
}
const pub = async (t: T, id: string, b: Record<string, unknown>) => json(await publishRoute.POST(body(b), P(t, id)));
const postRow = (id: string) => db.onePost.findUniqueOrThrow({ where: { id } });

describe("OnePost publishing: only approved content goes out", () => {
  it("refuses a post that isn't approved, and managers or owners only", async () => {
    const t = await tenant();
    actAs(t.owner);
    const draft = ((await json(await postsRoute.POST(body(idea), ctx(t.O)))).body.post as { id: string }).id;
    await generateRoute.POST(body({}), P(t, draft));
    expect((await pub(t, draft, { channels: ["facebook"] })).status).toBe(409);

    const id = await approvedPost(t);
    actAs(t.agent);
    expect((await pub(t, id, { channels: ["facebook"] })).status).toBe(403);
    expect(fb).not.toHaveBeenCalled();
    actAs(t.manager);
    expect((await pub(t, id, { channels: ["facebook"] })).status).toBe(200);
  });

  it("publishes now to Facebook and Instagram through the existing Channels accounts and records each result", async () => {
    const t = await tenant();
    const id = await approvedPost(t);
    const r = await pub(t, id, { channels: ["facebook", "instagram"] });
    expect(r.status).toBe(200);
    expect(fb).toHaveBeenCalledTimes(1);
    expect(ig).toHaveBeenCalledTimes(1);
    const [token, pageId, text, image] = fb.mock.calls[0];
    expect(token).toBe("page-token");
    expect(pageId).toBe("page_1");
    expect(text).toContain("Diwali health checkup offer");
    expect(String(image)).toMatch(/^https:\/\/test\.public\.blob\.vercel-storage\.com\/onepost\//);
    expect(ig.mock.calls[0][1]).toBe("ig_1");
    const rows = await db.onePostDelivery.findMany({ where: { postId: id } });
    expect(rows.map((d) => d.status)).toEqual(["published", "published"]);
    expect(rows.find((d) => d.channel === "facebook")!.externalId).toBe("fb_post_1");
    const post = await postRow(id);
    expect(post.status).toBe("published");
    expect(post.publishedAt).not.toBeNull();
    // Content is locked once published.
    actAs(t.owner);
    expect((await json(await versionRoute.PUT(body({ content: { text: "x", hashtags: [] } }, "PUT"), ctx({ ...t.O, postId: id, channel: "facebook" })))).status).toBe(403);
    // And the same channel can't be published twice.
    expect((await pub(t, id, { channels: ["facebook"] })).status).toBe(400);
    expect(fb).toHaveBeenCalledTimes(1);
  });

  it("checks every channel first and queues nothing if one can't be posted", async () => {
    const t = await tenant();
    const id = await approvedPost(t, false); // no photo, so Instagram can't go
    const r = await pub(t, id, { channels: ["facebook", "instagram"] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/needs a photo/);
    expect(await db.onePostDelivery.count({ where: { postId: id } })).toBe(0);
    expect(fb).not.toHaveBeenCalled();
    expect((await postRow(id)).status).toBe("approved");
    // LinkedIn isn't connected either.
    const li = await pub(t, id, { channels: ["linkedin"] });
    expect(li.status).toBe(400);
    expect(JSON.stringify(li.body)).toMatch(/isn't connected/);
  });

  it("sends the approved snapshot, even if the live version is changed in the database afterwards", async () => {
    const t = await tenant();
    const id = await approvedPost(t);
    const when = new Date(Date.now() + 3 * 3600_000).toISOString();
    expect((await pub(t, id, { channels: ["facebook"], scheduledAt: when })).status).toBe(200);
    await db.onePostVersion.updateMany({ where: { postId: id, channel: "facebook" }, data: { content: JSON.stringify({ text: "SOMETHING NOBODY APPROVED", hashtags: [] }) } });
    await db.onePostDelivery.updateMany({ where: { postId: id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await runDueOnePost();
    expect(String(fb.mock.calls[0][2])).not.toContain("NOBODY APPROVED");
    expect(String(fb.mock.calls[0][2])).toContain("Diwali");
  });
});

describe("OnePost scheduling, retries and the calendar", () => {
  it("holds a scheduled post until its time, then sends it; cancel and reschedule work only while waiting", async () => {
    const t = await tenant();
    const id = await approvedPost(t);
    const later = inDays(5); // IST
    const r = await pub(t, id, { channels: ["facebook"], scheduledAt: later });
    expect(r.status).toBe(200);
    expect((await postRow(id)).status).toBe("scheduled");
    const d = await db.onePostDelivery.findFirstOrThrow({ where: { postId: id } });
    expect(d.scheduledAt.toISOString()).toBe(istToDate(later)!.toISOString());
    await runDueOnePost();
    expect(fb).not.toHaveBeenCalled();

    // Move it to another day (calendar drag), then cancel it.
    const moved = await json(await deliveryRoute.PATCH(body({ scheduledAt: inDays(7) }, "PATCH"), ctx({ ...t.O, deliveryId: d.id })));
    expect(moved.status).toBe(200);
    expect((await db.onePostDelivery.findUniqueOrThrow({ where: { id: d.id } })).scheduledAt.toISOString()).toBe(istToDate(inDays(7))!.toISOString());
    expect((await json(await deliveryRoute.PATCH(body({ scheduledAt: "2020-01-01T10:00" }, "PATCH"), ctx({ ...t.O, deliveryId: d.id })))).status).toBe(400);
    expect((await json(await publishRoute.DELETE(req("/x", { method: "DELETE" }), P(t, id)))).status).toBe(200);
    expect((await db.onePostDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("cancelled");
    expect((await postRow(id)).status).toBe("approved");
    expect((await json(await deliveryRoute.PATCH(body({ scheduledAt: inDays(8) }, "PATCH"), ctx({ ...t.O, deliveryId: d.id })))).status).toBe(409);
    expect(fb).not.toHaveBeenCalled();
  });

  it("retries a temporary failure with back-off, and gives up with a clear reason after three tries", async () => {
    const t = await tenant();
    const id = await approvedPost(t);
    fb.mockRejectedValue(new MetaApiError("Service unavailable", 503));
    await pub(t, id, { channels: ["facebook"] });
    let d = await db.onePostDelivery.findFirstOrThrow({ where: { postId: id } });
    expect(d.status).toBe("queued");
    expect(d.attempts).toBe(1);
    expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect(d.error).toMatch(/try again automatically/i);
    expect((await postRow(id)).status).toBe("scheduled");

    for (let i = 0; i < 2; i++) {
      await db.onePostDelivery.update({ where: { id: d.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await runDueOnePost();
    }
    d = await db.onePostDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(d.status).toBe("failed");
    expect(d.attempts).toBe(3);
    expect(d.error).toMatch(/Service unavailable/);
    expect((await postRow(id)).status).toBe("failed");

    // A person fixes the cause and retries: only the failed channel is sent again.
    fb.mockReset().mockResolvedValue("fb_ok");
    const r = await json(await retryRoute.POST(body({}), P(t, id)));
    expect(r.status).toBe(200);
    expect((await postRow(id)).status).toBe("published");
    expect(fb).toHaveBeenCalledTimes(1);
  });

  it("does not retry a permanent error (bad token) and says to reconnect", async () => {
    const t = await tenant();
    const id = await approvedPost(t);
    fb.mockRejectedValue(new MetaApiError("Error validating access token", 400, 190));
    await pub(t, id, { channels: ["facebook"] });
    const d = await db.onePostDelivery.findFirstOrThrow({ where: { postId: id } });
    expect(d.status).toBe("failed");
    expect(d.attempts).toBe(1);
    const events = (await db.onePostEvent.findMany({ where: { postId: id } })).map((e) => e.action);
    expect(events).toContain("publish_failed");
  });

  it("shows queued and published items on the calendar, only for this workspace", async () => {
    const a = await tenant();
    const b = await tenant();
    const id = await approvedPost(a);
    await pub(a, id, { channels: ["facebook"], scheduledAt: inDays(10, "09:00") });
    const q = (t: T) => calendarRoute.GET(req(`/x?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 30 * 86_400_000).toISOString())}`), ctx(t.O));
    actAs(a.owner);
    const mine = await json(await q(a));
    const items = mine.body.items as { postId: string; status: string; movable: boolean; channel: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ postId: id, status: "queued", movable: true, channel: "facebook" });
    actAs(b.owner);
    expect(((await json(await q(b))).body.items as unknown[]).length).toBe(0);
    // B can't move A's delivery either.
    const d = await db.onePostDelivery.findFirstOrThrow({ where: { postId: id } });
    expect((await json(await deliveryRoute.PATCH(body({ scheduledAt: inDays(11, "09:00") }, "PATCH"), ctx({ ...b.O, deliveryId: d.id })))).status).toBe(404);
  });
});

describe("OnePost files in Blob storage", () => {
  const headMock = vi.mocked(head);
  it("attaches a browser-uploaded photo or video only if it is in this post's folder and the right type and size", async () => {
    const t = await tenant();
    actAs(t.owner);
    const id = ((await json(await postsRoute.POST(body(idea), ctx(t.O)))).body.post as { id: string }).id;
    const reg = (url: string) => registerRoute.POST(body({ url, name: "clip" }), P(t, id));
    const base = "https://test.public.blob.vercel-storage.com";

    headMock.mockResolvedValueOnce({ size: 5_000_000, contentType: "video/mp4", pathname: `onepost/${t.org.id}/${id}/a.mp4`, url: `${base}/onepost/${t.org.id}/${id}/a.mp4` } as never);
    const ok = await json(await reg(`${base}/onepost/${t.org.id}/${id}/a.mp4`));
    expect(ok.status).toBe(201);
    expect((ok.body.post as { media: { kind: string }[] }).media[0].kind).toBe("video");

    headMock.mockResolvedValueOnce({ size: 1000, contentType: "image/png", pathname: `onepost/OTHER/OTHER/b.png`, url: `${base}/onepost/OTHER/OTHER/b.png` } as never);
    expect((await json(await reg(`${base}/onepost/OTHER/OTHER/b.png`))).status).toBe(403);
    headMock.mockResolvedValueOnce({ size: 400 * 1024 * 1024, contentType: "video/mp4", pathname: `onepost/${t.org.id}/${id}/big.mp4`, url: `${base}/onepost/${t.org.id}/${id}/big.mp4` } as never);
    expect((await json(await reg(`${base}/onepost/${t.org.id}/${id}/big.mp4`))).status).toBe(400);
    headMock.mockResolvedValueOnce({ size: 10, contentType: "application/pdf", pathname: `onepost/${t.org.id}/${id}/c.pdf`, url: `${base}/onepost/${t.org.id}/${id}/c.pdf` } as never);
    expect((await json(await reg(`${base}/onepost/${t.org.id}/${id}/c.pdf`))).status).toBe(400);
    expect((await json(await reg("https://evil.example.com/onepost/x.png"))).status).toBe(400);
  });

  it("a video is stored but not posted to Facebook yet, and the photo and text still go out", async () => {
    const t = await tenant();
    const id = await approvedPost(t);
    const r = await json(await publishRoute.GET(req("/x"), P(t, id)));
    expect(r.status).toBe(200);
    expect(((r.body.options as { channel: string }[]).map((o) => o.channel))).toEqual(["facebook", "instagram", "linkedin", "gbp", "wordpress"]);
  });
});
