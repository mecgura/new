import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string) => ({ url: `https://test.public.blob.vercel-storage.com/${pathname}`, pathname })),
  del: vi.fn(async () => undefined),
  head: vi.fn(),
}));
vi.mock("@/providers/openai/chat", () => ({ complete: vi.fn(), OPENAI_MODEL: "gpt-test", openaiConfigured: () => true }));
vi.mock("@/providers/ai/router", () => ({ resolveProviders: vi.fn(async () => ({ primary: null, fallback: null, settings: { provider: "auto", fallback: false, models: { anthropic: "c", openai: "o" } } })) }));

import { del, head } from "@vercel/blob";
import { complete } from "@/providers/openai/chat";
import { resolveProviders } from "@/providers/ai/router";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, req } from "../helpers";
import * as eventsRoute from "@/app/api/organizations/[orgId]/onepost/events/route";
import * as postRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/route";
import * as generateRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/generate/route";
import * as mediaRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/route";
import * as mediaItemRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/[mediaId]/route";
import * as registerRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/register/route";
import * as shareRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/event/share-media/route";
import { phaseChannels } from "@/lib/onepost-event";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ctx = <X extends Record<string, string>>(p: X) => ({ params: Promise.resolve(p) });
const body = (b: unknown, method = "POST") => req("/x", { method, body: b });
const event = { eventName: "Winter Health Camp", eventDate: "2026-12-05", eventPlace: "Mehta Clinic, Mall Road, Shimla", highlights: "Free BP and sugar checks. 200 families expected. Dr Mehta will speak at 11am.", city: "Shimla" };

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(del).mockClear();
});

let n = 0;
async function tenant() {
  const org = await makeOrg(`Event ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, agent.id, "AGENT");
  await db.organizationService.create({ data: { organizationId: org.id, service: "ONEPOST", enabled: true } });
  return { org, owner, agent, O: { orgId: org.id } };
}
type T = Awaited<ReturnType<typeof tenant>>;
const P = <E extends Record<string, string> = Record<never, never>>(t: T, postId: string, extra?: E) => ctx({ ...t.O, postId, ...(extra as E) });
async function campaign(t: T) {
  actAs(t.owner);
  const r = await json(await eventsRoute.POST(body(event), ctx(t.O)));
  expect(r.status).toBe(201);
  return r.body as { groupId: string; posts: { id: string; phase: string }[] };
}

describe("Event Mode: one event, a five-post campaign", () => {
  it("creates teaser, live, recap, gallery and press release as drafts that share the event's facts", async () => {
    const t = await tenant();
    const c = await campaign(t);
    expect(c.posts.map((p) => p.phase)).toEqual(["teaser", "live", "recap", "gallery", "press"]);
    const rows = await db.onePost.findMany({ where: { eventGroupId: c.groupId } });
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.status).toBe("draft");
      expect(r.postType).toBe("event");
      expect(r.eventName).toBe("Winter Health Camp");
      expect(r.eventPlace).toContain("Mall Road");
      expect(r.eventDate?.toISOString()).toBe("2026-12-05T03:30:00.000Z");
      expect(r.brief).toContain("200 families expected");
    }
    expect(await db.onePostVersion.count({ where: { organizationId: t.org.id } })).toBe(0);
    const detail = (await json(await postRoute.GET(req("/x"), P(t, c.posts[0].id)))).body.post as { siblings: { phase: string }[] };
    expect(detail.siblings.map((s) => s.phase)).toEqual(["teaser", "live", "recap", "gallery", "press"]);
  });

  it("writes only the channels that suit each part of the campaign", async () => {
    const t = await tenant();
    const c = await campaign(t);
    for (const p of c.posts) {
      const r = await json(await generateRoute.POST(body({}), P(t, p.id)));
      expect(r.status).toBe(200);
      const channels = (r.body.post as { versions: { channel: string }[] }).versions.map((v) => v.channel).sort();
      expect(channels, p.phase).toEqual([...phaseChannels(p.phase)].sort());
    }
    expect(phaseChannels("press")).toEqual(["press_release", "pitch_email"]);
    expect(phaseChannels("recap")).toContain("blog");
  });

  it("tells the AI which part of the campaign it is, and gives it only the event's own facts", async () => {
    const t = await tenant();
    const c = await campaign(t);
    vi.mocked(resolveProviders).mockResolvedValue({ primary: "openai", fallback: null, settings: { provider: "openai", fallback: false, models: { anthropic: "c", openai: "o" } } } as never);
    vi.mocked(complete).mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ caption: "Join us on 5 December at Mehta Clinic.", hashtags: ["WinterHealthCamp"] }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } as never);
    actAs(t.owner);
    const r = await json(await generateRoute.POST(body({ channels: ["instagram"] }), P(t, c.posts[0].id)));
    expect(r.status).toBe(200);
    const sent = (vi.mocked(complete).mock.calls[0][0] as { messages: { role: string; content: string }[] }).messages;
    expect(sent[0].content).toMatch(/Never invent prices/);
    expect(sent[1].content).toContain("Event campaign part: Pre-event teaser");
    expect(sent[1].content).toContain("Do not write as if it has already happened");
    expect(sent[1].content).toContain("Event: Winter Health Camp on 5 December 2026 at Mehta Clinic, Mall Road, Shimla");
    expect(sent[1].content).toContain("200 families expected");
    vi.mocked(resolveProviders).mockResolvedValue({ primary: null, fallback: null, settings: { provider: "auto", fallback: false, models: { anthropic: "c", openai: "o" } } } as never);
  });

  it("validates the event, and keeps campaigns private to their workspace", async () => {
    const a = await tenant();
    const b = await tenant();
    actAs(a.owner);
    expect((await json(await eventsRoute.POST(body({ ...event, eventDate: "2026-02-31" }), ctx(a.O)))).status).toBe(400);
    expect((await json(await eventsRoute.POST(body({ ...event, eventName: "" }), ctx(a.O)))).status).toBe(400);
    const c = await campaign(a);
    actAs(b.owner);
    expect((await json(await shareRoute.POST(body({}), P(b, c.posts[0].id)))).status).toBe(404);
    expect((await json(await postRoute.GET(req("/x"), P(b, c.posts[0].id)))).status).toBe(404);
  });

  it("uses one post's photos in all the event posts, without uploading twice", async () => {
    const t = await tenant();
    const c = await campaign(t);
    actAs(t.owner);
    expect((await json(await shareRoute.POST(body({}), P(t, c.posts[0].id)))).status).toBe(400); // no photos yet
    await mediaRoute.POST(body({ name: "camp.png", image: PNG }), P(t, c.posts[0].id));
    const r = await json(await shareRoute.POST(body({}), P(t, c.posts[0].id)));
    expect(r.body).toMatchObject({ copied: 4, posts: 4 });
    for (const p of c.posts) expect(await db.onePostMedia.count({ where: { postId: p.id } }), p.phase).toBe(1);
    // Sharing again adds nothing.
    expect((await json(await shareRoute.POST(body({}), P(t, c.posts[0].id)))).body).toMatchObject({ copied: 0 });
  });

  it("a shared stored file is deleted only when the last post using it lets go", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
    const t = await tenant();
    const c = await campaign(t);
    actAs(t.owner);
    const first = c.posts[0].id;
    const url = `https://test.public.blob.vercel-storage.com/onepost/${t.org.id}/${first}/shared.jpg`;
    vi.mocked(head).mockResolvedValueOnce({ size: 1000, contentType: "image/jpeg", pathname: `onepost/${t.org.id}/${first}/shared.jpg`, url } as never);
    await registerRoute.POST(body({ url, name: "shared.jpg" }), P(t, first));
    await shareRoute.POST(body({}), P(t, first));
    const mediaIds = await Promise.all(c.posts.map(async (p) => (await db.onePostMedia.findFirstOrThrow({ where: { postId: p.id } })).id));
    for (let i = 0; i < 4; i++) {
      await mediaItemRoute.DELETE(req("/x", { method: "DELETE" }), P(t, c.posts[i].id, { mediaId: mediaIds[i] }));
      expect(vi.mocked(del), `after removing from post ${i + 1}`).not.toHaveBeenCalled();
    }
    await mediaItemRoute.DELETE(req("/x", { method: "DELETE" }), P(t, c.posts[4].id, { mediaId: mediaIds[4] }));
    expect(vi.mocked(del)).toHaveBeenCalledWith([url]);
  });
});
