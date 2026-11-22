import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string) => ({ url: `https://test.public.blob.vercel-storage.com/${pathname}`, pathname })),
  del: vi.fn(async () => undefined),
  head: vi.fn(),
}));

import { head, put } from "@vercel/blob";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { actAs, addMember, json, makeOrg, makeUser, req } from "../helpers";
import * as postsRoute from "@/app/api/organizations/[orgId]/onepost/posts/route";
import * as generateRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/generate/route";
import * as statusRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/status/route";
import * as mediaRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/route";
import * as registerRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/register/route";
import * as variantsRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/[mediaId]/variants/route";
import * as thumbRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/[mediaId]/thumbnail/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/publish/route";
import * as brandRoute from "@/app/api/organizations/[orgId]/onepost/brand/route";
import * as logoRoute from "@/app/api/organizations/[orgId]/onepost/brand/logo/route";
import * as connRoute from "@/app/api/organizations/[orgId]/onepost/connections/[id]/route";
import * as startRoute from "@/app/api/organizations/[orgId]/onepost/connections/oauth/[provider]/route";
import * as callbackRoute from "@/app/api/onepost/oauth/[provider]/callback/route";
import { pickPhoto } from "@/lib/onepost-media";
import { renderVariant } from "@/services/onepost/media-studio";

const headMock = vi.mocked(head);
const putMock = vi.mocked(put);
const ctx = <X extends Record<string, string>>(p: X) => ({ params: Promise.resolve(p) });
const body = (b: unknown, method = "POST") => req("/x", { method, body: b });
let calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const j = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
function mockFetch(handlers: [string, Handler][]) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()), body: init.body instanceof URLSearchParams ? init.body.toString() : typeof init.body === "string" ? init.body : init.body ? "[stream]" : "" });
    for (const [prefix, h] of handlers) if (url.startsWith(prefix)) return h(url, init);
    throw new Error(`Unmocked fetch: ${url}`);
  }));
}

async function photo(w = 1600, h = 1200) {
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 80, b: 40 } } }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "g-client");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "g-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  putMock.mockClear();
});

let n = 0;
async function tenant() {
  const org = await makeOrg(`Media ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, agent.id, "AGENT");
  await db.organizationService.create({ data: { organizationId: org.id, service: "ONEPOST", enabled: true } });
  return { org, owner, agent, O: { orgId: org.id } };
}
type T = Awaited<ReturnType<typeof tenant>>;
const P = (t: T, postId: string, extra: Record<string, string> = {}) => ctx({ ...t.O, postId, ...extra });
async function newPost(t: T) {
  actAs(t.owner);
  return ((await json(await postsRoute.POST(body({ title: "Winter camp", brief: "Camp on 5 December in Shimla." }), ctx(t.O)))).body.post as { id: string }).id;
}

describe("Media Studio: resized copies, logo and cover frames", () => {
  it("crops to each shape without stretching, and the logo lands in the corner", async () => {
    const src = Buffer.from((await photo(1600, 1200)).split(",")[1], "base64");
    for (const [ratio, w, h] of [["1:1", 1080, 1080], ["4:5", 1080, 1350], ["9:16", 1080, 1920], ["16:9", 1920, 1080]] as const) {
      const out = await renderVariant(new Uint8Array(src), ratio);
      const m = await sharp(out.bytes).metadata();
      expect([m.width, m.height], ratio).toEqual([w, h]);
      expect(m.format).toBe("jpeg");
    }
    const logo = new Uint8Array(await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer());
    const marked = await renderVariant(new Uint8Array(src), "1:1", logo);
    const px = await sharp(marked.bytes).extract({ left: 1080 - 60, top: 1080 - 40, width: 4, height: 4 }).raw().toBuffer();
    expect(px[2]).toBeGreaterThan(150); // blue logo pixels bottom-right
    const plain = await renderVariant(new Uint8Array(src), "1:1");
    const px2 = await sharp(plain.bytes).extract({ left: 1080 - 60, top: 1080 - 40, width: 4, height: 4 }).raw().toBuffer();
    expect(px2[2]).toBeLessThan(100);
  });

  it("makes copies of an original photo (replacing a copy of the same shape), keeps originals at six, and needs a logo for the logo option", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    const t = await tenant();
    const id = await newPost(t);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(Buffer.from((await photo()).split(",")[1], "base64")))));
    const added = await json(await mediaRoute.POST(body({ name: "camp.png", image: await photo() }), P(t, id)));
    const mediaId = (added.body.post as { media: { id: string }[] }).media[0].id;

    const bad = await json(await variantsRoute.POST(body({ ratios: ["4:5"], watermark: true }), P(t, id, { mediaId })));
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toMatch(/logo/i);

    const r = await json(await variantsRoute.POST(body({ ratios: ["4:5", "16:9"], watermark: false }), P(t, id, { mediaId })));
    expect(r.status).toBe(200);
    const media = (r.body.post as { media: { ratio: string; variantOf: string; url: string }[] }).media;
    expect(media.filter((m) => m.variantOf === mediaId).map((m) => m.ratio).sort()).toEqual(["16:9", "4:5"]);
    // Again: same shape is replaced, not duplicated.
    await variantsRoute.POST(body({ ratios: ["4:5"], watermark: false }), P(t, id, { mediaId }));
    expect(await db.onePostMedia.count({ where: { postId: id, variantOf: mediaId, ratio: "4:5" } })).toBe(1);
    expect(putMock.mock.calls.some(([p]) => String(p).includes("camp-4x5.jpg"))).toBe(true);

    // Copies don't use up the six-photo allowance.
    for (let i = 0; i < 5; i++) expect((await json(await mediaRoute.POST(body({ name: `p${i}.png`, image: await photo(400, 400) }), P(t, id)))).status).toBe(201);
    expect((await json(await mediaRoute.POST(body({ name: "p6.png", image: await photo(400, 400) }), P(t, id)))).status).toBe(400);
  });

  it("puts the brand logo on the copy when asked", async () => {
    const t = await tenant();
    const id = await newPost(t);
    actAs(t.owner);
    const logo = await sharp({ create: { width: 120, height: 60, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer();
    expect((await json(await logoRoute.POST(body({ image: `data:image/png;base64,${logo.toString("base64")}` }), ctx(t.O)))).status).toBe(200);
    const added = await json(await mediaRoute.POST(body({ name: "camp.png", image: await photo() }), P(t, id)));
    const mediaId = (added.body.post as { media: { id: string }[] }).media[0].id;
    const r = await json(await variantsRoute.POST(body({ ratios: ["1:1"], watermark: true }), P(t, id, { mediaId })));
    expect(r.status).toBe(200);
    const row = await db.onePostMedia.findFirstOrThrow({ where: { postId: id, variantOf: mediaId } });
    expect(row.watermarked).toBe(true);
    const px = await sharp(Buffer.from(row.bytes)).extract({ left: 1080 - 60, top: 1080 - 40, width: 4, height: 4 }).raw().toBuffer();
    expect(px[2]).toBeGreaterThan(150);
    void brandRoute;
  });

  it("only the right people can make copies", async () => {
    const t = await tenant();
    const id = await newPost(t);
    const added = await json(await mediaRoute.POST(body({ name: "camp.png", image: await photo() }), P(t, id)));
    const mediaId = (added.body.post as { media: { id: string }[] }).media[0].id;
    actAs(t.agent); // not their post
    expect((await json(await variantsRoute.POST(body({ ratios: ["1:1"] }), P(t, id, { mediaId })))).status).toBe(403);
    actAs(t.owner);
    expect((await json(await variantsRoute.POST(body({ ratios: ["7:3"] }), P(t, id, { mediaId })))).status).toBe(400);
  });

  it("sends each channel the shape it likes best", () => {
    const m = (id: string, extra: object = {}) => ({ id, kind: "image", variantOf: "", ratio: "", watermarked: false, position: 0, ...extra });
    const media = [m("o"), m("w45", { variantOf: "o", ratio: "4:5", watermarked: true }), m("p45", { variantOf: "o", ratio: "4:5" }), m("w169", { variantOf: "o", ratio: "16:9" })];
    expect(pickPhoto("instagram", media)?.id).toBe("w45");
    expect(pickPhoto("youtube", media)?.id).toBe("w169");
    expect(pickPhoto("facebook", media)?.id).toBe("w169");
    expect(pickPhoto("instagram", [m("o")])?.id).toBe("o");
    expect(pickPhoto("instagram", [])).toBeUndefined();
  });

  it("saves a video's cover frame only from this post's folder", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    const t = await tenant();
    const id = await newPost(t);
    const base = "https://test.public.blob.vercel-storage.com";
    headMock.mockResolvedValueOnce({ size: 9_000_000, contentType: "video/mp4", pathname: `onepost/${t.org.id}/${id}/v.mp4`, url: `${base}/onepost/${t.org.id}/${id}/v.mp4` } as never);
    const reg = await json(await registerRoute.POST(body({ url: `${base}/onepost/${t.org.id}/${id}/v.mp4`, name: "v.mp4" }), P(t, id)));
    const mediaId = (reg.body.post as { media: { id: string }[] }).media[0].id;
    headMock.mockResolvedValueOnce({ size: 5000, contentType: "image/jpeg", pathname: `onepost/${t.org.id}/${id}/cover.jpg`, url: `${base}/onepost/${t.org.id}/${id}/cover.jpg` } as never);
    const ok = await json(await thumbRoute.POST(body({ url: `${base}/onepost/${t.org.id}/${id}/cover.jpg` }), P(t, id, { mediaId })));
    expect(ok.status).toBe(200);
    expect((ok.body.post as { media: { thumbUrl: string }[] }).media[0].thumbUrl).toMatch(/cover\.jpg$/);
    headMock.mockResolvedValueOnce({ size: 5000, contentType: "image/jpeg", pathname: `onepost/OTHER/OTHER/x.jpg`, url: `${base}/onepost/OTHER/OTHER/x.jpg` } as never);
    expect((await json(await thumbRoute.POST(body({ url: `${base}/onepost/OTHER/OTHER/x.jpg` }), P(t, id, { mediaId })))).status).toBe(403);
  });
});

describe("YouTube", () => {
  async function connectYoutube(t: T) {
    mockFetch([
      ["https://oauth2.googleapis.com/token", () => j({ access_token: "yt-access", refresh_token: "yt-refresh", expires_in: 3600, scope: "youtube.upload" })],
      ["https://www.googleapis.com/youtube/v3/channels", () => j({ items: [{ id: "UC123", snippet: { title: "Mehta Clinic" } }] })],
    ]);
    actAs(t.owner);
    const s = await json(await startRoute.POST(body({}), ctx({ ...t.O, provider: "youtube" })));
    const u = new URL(String(s.body.url));
    expect(u.searchParams.get("scope")).toContain("youtube.upload");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("redirect_uri")).toMatch(/\/oauth\/youtube\/callback$/);
    const res = await callbackRoute.GET(new Request(`http://localhost:3000/x?code=c&state=${u.searchParams.get("state")}`), ctx({ provider: "youtube" }));
    expect(res.headers.get("location")).toMatch(/connected=youtube/);
  }

  it("connects a channel, needs a video, then uploads it with the approved title, description and cover", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    const t = await tenant();
    await connectYoutube(t);
    const conn = await db.onePostConnection.findFirstOrThrow({ where: { organizationId: t.org.id } });
    expect(conn).toMatchObject({ provider: "youtube", status: "active", externalId: "UC123" });

    actAs(t.owner);
    const id = await newPost(t);
    await generateRoute.POST(body({}), P(t, id));
    await statusRoute.POST(body({ action: "approve" }), P(t, id));
    const noVideo = await json(await publishRoute.POST(body({ channels: ["youtube"] }), P(t, id)));
    expect(noVideo.status).toBe(400);
    expect(JSON.stringify(noVideo.body)).toMatch(/needs a video/);

    // Add a video and a cover (as the browser would), then re-open and approve again.
    await statusRoute.POST(body({ action: "reopen" }), P(t, id));
    const base = "https://test.public.blob.vercel-storage.com";
    headMock.mockResolvedValueOnce({ size: 4_000_000, contentType: "video/mp4", pathname: `onepost/${t.org.id}/${id}/v.mp4`, url: `${base}/onepost/${t.org.id}/${id}/v.mp4` } as never);
    const reg = await json(await registerRoute.POST(body({ url: `${base}/onepost/${t.org.id}/${id}/v.mp4`, name: "v.mp4" }), P(t, id)));
    const mediaId = (reg.body.post as { media: { id: string }[] }).media[0].id;
    headMock.mockResolvedValueOnce({ size: 5000, contentType: "image/jpeg", pathname: `onepost/${t.org.id}/${id}/cover.jpg`, url: `${base}/onepost/${t.org.id}/${id}/cover.jpg` } as never);
    await thumbRoute.POST(body({ url: `${base}/onepost/${t.org.id}/${id}/cover.jpg` }), P(t, id, { mediaId }));
    await statusRoute.POST(body({ action: "approve" }), P(t, id));

    // Privacy setting is chosen per connection.
    expect((await json(await connRoute.PATCH(body({ ytPrivacy: "unlisted" }, "PATCH"), ctx({ ...t.O, id: conn.id })))).status).toBe(200);
    expect((await json(await connRoute.PATCH(body({ wpStatus: "draft" }, "PATCH"), ctx({ ...t.O, id: conn.id })))).status).toBe(400);

    mockFetch([
      ["https://www.googleapis.com/upload/youtube/v3/videos", (_u, init) => (init.method === "POST" ? new Response(null, { status: 200, headers: { location: "https://upload.youtube.test/session1" } }) : j({}))],
      [`${base}/onepost/${t.org.id}/${id}/cover.jpg`, () => new Response(new Uint8Array([255, 216, 255]))],
      [`${base}/onepost/${t.org.id}/${id}/v.mp4`, () => new Response(new Uint8Array([0, 0, 0, 24]))],
      ["https://upload.youtube.test/session1", () => j({ id: "vid42" })],
      ["https://www.googleapis.com/upload/youtube/v3/thumbnails/set", () => j({ items: [] })],
    ]);
    const r = await json(await publishRoute.POST(body({ channels: ["youtube"] }), P(t, id)));
    expect(r.status).toBe(200);
    const d = await db.onePostDelivery.findFirstOrThrow({ where: { postId: id } });
    expect(d).toMatchObject({ status: "published", externalId: "vid42", externalUrl: "https://www.youtube.com/watch?v=vid42" });
    const init = calls.find((c) => c.url.includes("uploadType=resumable"))!;
    const meta = JSON.parse(init.body);
    expect(meta.status.privacyStatus).toBe("unlisted");
    expect(meta.snippet.title.length).toBeGreaterThan(3);
    expect(init.headers["x-upload-content-length"]).toBe("4000000");
    expect(init.headers.authorization).toBe("Bearer yt-access");
    expect(calls.some((c) => c.url.includes("thumbnails/set"))).toBe(true);
    void encryptSecret;
  });
});
