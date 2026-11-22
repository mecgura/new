import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, req } from "../helpers";
import * as postsRoute from "@/app/api/organizations/[orgId]/onepost/posts/route";
import * as postRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/route";
import * as generateRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/generate/route";
import * as statusRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/status/route";
import * as versionRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/versions/[channel]/route";
import * as mediaRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/route";
import * as mediaFileRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/[mediaId]/route";
import * as brandRoute from "@/app/api/organizations/[orgId]/onepost/brand/route";
import * as logoRoute from "@/app/api/organizations/[orgId]/onepost/brand/logo/route";
import { CHANNEL_KEYS, CONTENT_SCHEMAS } from "@/lib/onepost";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

let n = 0;
async function tenant(enabled = true) {
  const org = await makeOrg(`OnePost ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const manager = await makeUser({ name: "Manager" });
  const agent = await makeUser({ name: "Agent" });
  const agent2 = await makeUser({ name: "Agent Two" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent.id, "AGENT");
  await addMember(org.id, agent2.id, "AGENT");
  if (enabled) await db.organizationService.create({ data: { organizationId: org.id, service: "ONEPOST", enabled: true } });
  return { org, owner, manager, agent, agent2, O: { orgId: org.id } };
}

const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const idea = { title: "Diwali health checkup offer", brief: "Full body checkup at Rs 999 from 1 to 10 November at our Shimla clinic.", postType: "offer", language: "en", tone: "friendly", city: "Shimla", keywords: "health checkup, Shimla", spokespersonName: "Dr Mehta, Founder", spokespersonQuote: "We want every family to start the year healthy." };

async function newPost(t: Awaited<ReturnType<typeof tenant>>, who: { id: string; email: string; role: string; sessionVersion: number }, body: Record<string, unknown> = idea) {
  actAs(who);
  const r = await json(await postsRoute.POST(req("/x", { method: "POST", body }), ctx(t.O)));
  expect(r.status).toBe(201);
  return (r.body.post as { id: string }).id;
}
const P = (t: { O: { orgId: string } }, postId: string) => ctx({ ...t.O, postId });
const gen = async (t: Awaited<ReturnType<typeof tenant>>, postId: string, body: Record<string, unknown> = {}) => json(await generateRoute.POST(req("/x", { method: "POST", body }), P(t, postId)));
const flow = async (t: Awaited<ReturnType<typeof tenant>>, postId: string, action: string, note = "") => json(await statusRoute.POST(req("/x", { method: "POST", body: { action, note } }), P(t, postId)));
const get = async (t: Awaited<ReturnType<typeof tenant>>, postId: string) => json(await postRoute.GET(req("/x"), P(t, postId)));

describe("OnePost: module switch and tenant isolation", () => {
  it("is closed until Super Admin switches the service on", async () => {
    const t = await tenant(false);
    actAs(t.owner);
    expect((await json(await postsRoute.GET(req("/x"), ctx(t.O)))).status).toBe(403);
    expect((await json(await postsRoute.POST(req("/x", { method: "POST", body: idea }), ctx(t.O)))).status).toBe(403);
    await db.organizationService.create({ data: { organizationId: t.org.id, service: "ONEPOST", enabled: true } });
    expect((await json(await postsRoute.GET(req("/x"), ctx(t.O)))).status).toBe(200);
  });

  it("never shows or changes another workspace's posts, media or brand", async () => {
    const a = await tenant();
    const b = await tenant();
    const id = await newPost(a, a.owner);
    actAs(a.owner);
    await mediaRoute.POST(req("/x", { method: "POST", body: { name: "a.png", image: PNG } }), P(a, id));
    await brandRoute.PUT(req("/x", { method: "PUT", body: { businessName: "Tenant A Clinic" } }), ctx(a.O));

    actAs(b.owner);
    // B's owner addressing A's post through B's own org id, and through A's org id.
    expect((await json(await postRoute.GET(req("/x"), P(b, id)))).status).toBe(404);
    expect((await json(await postRoute.GET(req("/x"), P(a, id)))).status).toBe(403);
    expect((await json(await postRoute.DELETE(req("/x", { method: "DELETE" }), P(b, id)))).status).toBe(404);
    expect((await json(await generateRoute.POST(req("/x", { method: "POST", body: {} }), P(b, id)))).status).toBe(404);
    const list = await json(await postsRoute.GET(req("/x"), ctx(b.O)));
    expect(list.body.posts).toEqual([]);
    expect(((await json(await brandRoute.GET(req("/x"), ctx(b.O)))).body.brand as { businessName: string }).businessName).not.toBe("Tenant A Clinic");
    const mediaId = (await db.onePostMedia.findFirstOrThrow({ where: { postId: id } })).id;
    expect((await mediaFileRoute.GET(req("/x"), ctx({ ...b.O, postId: id, mediaId }))).status).toBe(404);
    expect(await db.onePost.count({ where: { id } })).toBe(1);
  });
});

describe("OnePost: roles", () => {
  it("agents draft only: no review, no approval, nobody else's posts, no brand edits", async () => {
    const t = await tenant();
    const id = await newPost(t, t.agent);
    expect((await gen(t, id)).status).toBe(200);

    expect((await flow(t, id, "submit")).status).toBe(403);
    expect((await flow(t, id, "approve")).status).toBe(403);
    actAs(t.agent2);
    expect((await json(await versionRoute.PUT(req("/x", { method: "PUT", body: { content: {} } }), ctx({ ...t.O, postId: id, channel: "instagram" })))).status).toBe(403);
    expect((await json(await postRoute.PATCH(req("/x", { method: "PATCH", body: idea }), P(t, id)))).status).toBe(403);
    expect((await json(await postRoute.DELETE(req("/x", { method: "DELETE" }), P(t, id)))).status).toBe(403);
    actAs(t.agent);
    expect((await json(await brandRoute.PUT(req("/x", { method: "PUT", body: { businessName: "X" } }), ctx(t.O)))).status).toBe(403);
    // Their own draft they can still change and delete.
    expect((await json(await postRoute.PATCH(req("/x", { method: "PATCH", body: { ...idea, title: "New title" } }), P(t, id)))).status).toBe(200);
    expect((await json(await postRoute.DELETE(req("/x", { method: "DELETE" }), P(t, id)))).status).toBe(200);
  });

  it("managers send for review; only owners approve; Super Admin can do both", async () => {
    const t = await tenant();
    const id = await newPost(t, t.manager);
    await gen(t, id);
    expect((await flow(t, id, "submit")).status).toBe(200);
    expect((await flow(t, id, "approve")).status).toBe(403);
    actAs(t.owner);
    expect((await flow(t, id, "approve")).status).toBe(200);
    expect(((await get(t, id)).body.post as { status: string }).status).toBe("approved");

    const admin = await makeUser({ role: "SUPER_ADMIN" });
    const id2 = await newPost(t, admin);
    await gen(t, id2);
    expect((await flow(t, id2, "approve")).status).toBe(200);
  });
});

describe("OnePost: write once, a version for every channel", () => {
  it("writes all ten versions, each valid for its channel and within its limits", async () => {
    const t = await tenant();
    await brandRoute.PUT(req("/x", { method: "PUT", body: { businessName: "Mehta Clinic", services: "Health checkups", city: "Shimla", about: "Mehta Clinic is a family clinic in Shimla.", website: "https://mehtaclinic.example", contactEmail: "press@mehtaclinic.example" } }), ctx(t.O));
    const id = await newPost(t, t.owner);
    const r = await gen(t, id);
    expect(r.status).toBe(200);
    const post = r.body.post as { versions: { channel: string; content: unknown; model: string }[]; status: string };
    expect(post.versions.map((v) => v.channel).sort()).toEqual([...CHANNEL_KEYS].sort());
    for (const v of post.versions) {
      expect(() => CONTENT_SCHEMAS[v.channel as keyof typeof CONTENT_SCHEMAS].parse(v.content)).not.toThrow();
      expect(v.model).toBe("demo");
    }
    const g = post.versions.find((v) => v.channel === "gbp")!.content as { text: string };
    expect(g.text.length).toBeLessThanOrEqual(1500);
    expect((post.versions.find((v) => v.channel === "ads")!.content as { variations: unknown[] }).variations).toHaveLength(3);
    expect((post.versions.find((v) => v.channel === "whatsapp")!.content as { body: string }).body.length).toBeLessThanOrEqual(1024);
  });

  it("uses only the quote the client supplied, and none when there isn't one", async () => {
    const t = await tenant();
    const withQuote = await newPost(t, t.owner);
    const a = (await gen(t, withQuote, { channels: ["press_release"] })).body.post as { versions: { content: { quoteText: string; quoteBy: string } }[] };
    expect(a.versions[0].content.quoteText).toBe("We want every family to start the year healthy.");
    expect(a.versions[0].content.quoteBy).toBe("Dr Mehta, Founder");

    const noQuote = await newPost(t, t.owner, { ...idea, spokespersonQuote: "", spokespersonName: "" });
    const b = (await gen(t, noQuote, { channels: ["press_release"] })).body.post as { versions: { content: { quoteText: string }; checks: string[] }[] };
    expect(b.versions[0].content.quoteText).toBe("");
    expect(b.versions[0].checks.join(" ")).toMatch(/never makes up quotes/i);
  });

  it("asks for the name of whoever said the quote", async () => {
    const t = await tenant();
    const id = await newPost(t, t.owner, { ...idea, spokespersonName: "" });
    const r = await gen(t, id, { channels: ["press_release"] });
    expect(r.status).toBe(400);
  });

  it("rewrites just one version and counts the generation", async () => {
    const t = await tenant();
    const id = await newPost(t, t.owner);
    await gen(t, id);
    const r = await json(await versionRoute.POST(req("/x", { method: "POST", body: { instruction: "shorter" } }), ctx({ ...t.O, postId: id, channel: "instagram" })));
    expect(r.status).toBe(200);
    const rows = await db.onePostVersion.findMany({ where: { postId: id } });
    expect(rows).toHaveLength(10);
    expect(rows.find((v) => v.channel === "instagram")!.generation).toBe(2);
    expect(rows.find((v) => v.channel === "blog")!.generation).toBe(1);
  });
});

describe("OnePost: editing and approval flow", () => {
  it("validates edits strictly and cleans hashtags", async () => {
    const t = await tenant();
    const id = await newPost(t, t.owner);
    await gen(t, id, { channels: ["instagram", "gbp"] });
    const edit = (channel: string, content: unknown) => versionRoute.PUT(req("/x", { method: "PUT", body: { content } }), ctx({ ...t.O, postId: id, channel }));
    expect((await json(await edit("gbp", { text: "x".repeat(1501), cta: "BOOK", ctaUrl: "" }))).status).toBe(400);
    expect((await json(await edit("nonsense", {}))).status).toBe(404);
    const ok = await json(await edit("instagram", { caption: "Fresh caption", hashtags: ["#Diwali", "health checkup", "##offer!"] }));
    expect(ok.status).toBe(200);
    const v = (ok.body.post as { versions: { channel: string; content: { hashtags: string[] }; edited: boolean }[] }).versions.find((x) => x.channel === "instagram")!;
    expect(v.content.hashtags).toEqual(["Diwali", "healthcheckup", "offer"]);
    expect(v.edited).toBe(true);
  });

  it("walks draft → in review → changes requested → in review → approved, and an edit removes approval", async () => {
    const t = await tenant();
    const id = await newPost(t, t.manager);
    expect((await flow(t, id, "submit")).status).toBe(400); // nothing written yet
    await gen(t, id);
    expect((await flow(t, id, "submit")).status).toBe(200);
    expect((await flow(t, id, "submit")).status).toBe(409);

    actAs(t.owner);
    expect((await flow(t, id, "request_changes", "")).status).toBe(400);
    const cr = await flow(t, id, "request_changes", "Add the clinic timings");
    expect((cr.body.post as { status: string; reviewNote: string }).status).toBe("changes_requested");
    expect((cr.body.post as { reviewNote: string }).reviewNote).toBe("Add the clinic timings");

    actAs(t.manager);
    expect((await flow(t, id, "submit")).status).toBe(200);
    actAs(t.owner);
    const ap = await flow(t, id, "approve");
    expect((ap.body.post as { status: string }).status).toBe("approved");
    expect(await db.onePost.findFirst({ where: { id, approvedById: t.owner.id } })).not.toBeNull();

    // Editing after approval sends it back to draft with approval cleared.
    const edited = await json(await versionRoute.PUT(req("/x", { method: "PUT", body: { content: { caption: "Changed after approval", hashtags: ["x"] } } }), ctx({ ...t.O, postId: id, channel: "instagram" })));
    expect((edited.body.post as { status: string }).status).toBe("draft");
    const row = await db.onePost.findUniqueOrThrow({ where: { id } });
    expect(row.approvedAt).toBeNull();
    expect(row.approvedById).toBeNull();
    const actions = (await db.onePostEvent.findMany({ where: { postId: id } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["created", "generated", "submit", "request_changes", "approve", "approval_reset"]));
  });

  it("nothing is published or sent: no status past approved can be reached", async () => {
    const t = await tenant();
    const id = await newPost(t, t.owner);
    await gen(t, id);
    await flow(t, id, "approve");
    const row = await db.onePost.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("approved");
    expect((await json(await statusRoute.POST(req("/x", { method: "POST", body: { action: "publish" } }), P(t, id)))).status).toBe(400);
  });
});

describe("OnePost: photos, logo and brand profile", () => {
  it("accepts images, rejects other files and stops at six", async () => {
    const t = await tenant();
    const id = await newPost(t, t.owner);
    const add = (image: string) => mediaRoute.POST(req("/x", { method: "POST", body: { name: "p.png", image } }), P(t, id));
    expect((await json(await add("data:text/html;base64,PGI+aGk8L2I+"))).status).toBe(400);
    for (let i = 0; i < 6; i++) expect((await json(await add(PNG))).status).toBe(201);
    expect((await json(await add(PNG))).status).toBe(400);
    const mediaId = (await db.onePostMedia.findFirstOrThrow({ where: { postId: id } })).id;
    const file = await mediaFileRoute.GET(req("/x"), ctx({ ...t.O, postId: id, mediaId }));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    const del = await json(await mediaFileRoute.DELETE(req("/x", { method: "DELETE" }), ctx({ ...t.O, postId: id, mediaId })));
    expect((del.body.post as { media: unknown[] }).media).toHaveLength(5);
  });

  it("saves the brand profile and logo for owners and managers only", async () => {
    const t = await tenant();
    actAs(t.manager);
    const saved = await json(await brandRoute.PUT(req("/x", { method: "PUT", body: { businessName: "Mehta Clinic", defaultHashtags: "#MehtaClinic", contactEmail: "bad" } }), ctx(t.O)));
    expect(saved.status).toBe(400);
    const okRes = await json(await brandRoute.PUT(req("/x", { method: "PUT", body: { businessName: "Mehta Clinic", defaultHashtags: "#MehtaClinic" } }), ctx(t.O)));
    expect((okRes.body.brand as { businessName: string }).businessName).toBe("Mehta Clinic");
    const logo = await json(await logoRoute.POST(req("/x", { method: "POST", body: { image: PNG } }), ctx(t.O)));
    expect((logo.body.brand as { hasLogo: boolean }).hasLogo).toBe(true);
    expect((await logoRoute.GET(req("/x"), ctx(t.O))).status).toBe(200);
    actAs(t.agent);
    expect((await json(await logoRoute.POST(req("/x", { method: "POST", body: { image: PNG } }), ctx(t.O)))).status).toBe(403);
    expect((await logoRoute.GET(req("/x"), ctx(t.O))).status).toBe(200); // agents may view it
    actAs(t.manager);
    expect((await json(await logoRoute.DELETE(req("/x", { method: "DELETE" }), ctx(t.O)))).status).toBe(200);
    expect((await logoRoute.GET(req("/x"), ctx(t.O))).status).toBe(404);
  });

  it("deleting a post removes its photos, versions and history", async () => {
    const t = await tenant();
    const id = await newPost(t, t.owner);
    await mediaRoute.POST(req("/x", { method: "POST", body: { name: "p.png", image: PNG } }), P(t, id));
    await gen(t, id, { channels: ["instagram"] });
    expect((await json(await postRoute.DELETE(req("/x", { method: "DELETE" }), P(t, id)))).status).toBe(200);
    expect(await db.onePostMedia.count({ where: { postId: id } })).toBe(0);
    expect(await db.onePostVersion.count({ where: { postId: id } })).toBe(0);
    expect(await db.onePostEvent.count({ where: { postId: id } })).toBe(0);
  });
});
