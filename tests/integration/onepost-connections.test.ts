import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string) => ({ url: `https://test.public.blob.vercel-storage.com/${pathname}`, pathname })),
  del: vi.fn(async () => undefined),
  head: vi.fn(),
}));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) }));

import { db } from "@/lib/db";
import { decryptSecret, sha256 } from "@/lib/crypto";
import { actAs, addMember, json, makeOrg, makeUser, req } from "../helpers";
import * as startRoute from "@/app/api/organizations/[orgId]/onepost/connections/oauth/[provider]/route";
import * as callbackRoute from "@/app/api/onepost/oauth/[provider]/callback/route";
import * as connectionsRoute from "@/app/api/organizations/[orgId]/onepost/connections/route";
import * as connectionRoute from "@/app/api/organizations/[orgId]/onepost/connections/[id]/route";
import * as targetsRoute from "@/app/api/organizations/[orgId]/onepost/connections/[id]/targets/route";
import * as wpRoute from "@/app/api/organizations/[orgId]/onepost/connections/wordpress/route";
import * as postsRoute from "@/app/api/organizations/[orgId]/onepost/posts/route";
import * as generateRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/generate/route";
import * as statusRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/status/route";
import * as mediaRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/media/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/publish/route";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
type Call = { url: string; method: string; headers: Record<string, string>; body: string };
let calls: Call[] = [];
type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const j = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });

function mockFetch(handlers: [string, Handler][]) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, method: init.method ?? "GET", headers: Object.fromEntries(new Headers(init.headers as HeadersInit).entries()), body: init.body instanceof URLSearchParams ? init.body.toString() : typeof init.body === "string" ? init.body : init.body ? "[binary]" : "" });
      for (const [prefix, h] of handlers) if (url.startsWith(prefix)) return h(url, init);
      throw new Error(`Unmocked fetch: ${url}`);
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-token");
  vi.stubEnv("LINKEDIN_CLIENT_ID", "li-client");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "li-secret");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "g-client");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "g-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let n = 0;
async function tenant() {
  const org = await makeOrg(`Conn ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const manager = await makeUser({ name: "Manager" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await db.organizationService.create({ data: { organizationId: org.id, service: "ONEPOST", enabled: true } });
  return { org, owner, manager, O: { orgId: org.id } };
}
type T = Awaited<ReturnType<typeof tenant>>;
const ctx = <X extends Record<string, string>>(p: X) => ({ params: Promise.resolve(p) });
const post = (b: unknown, method = "POST") => req("/x", { method, body: b });

/** Runs the whole sign-in: start, then the provider sends the person back with a code. */
async function signIn(t: T, provider: "linkedin" | "gbp", who = t.owner) {
  actAs(who);
  const s = await json(await startRoute.POST(post({}), ctx({ ...t.O, provider })));
  expect(s.status).toBe(200);
  const state = new URL(String(s.body.url)).searchParams.get("state")!;
  const res = await callbackRoute.GET(new Request(`http://localhost:3000/api/onepost/oauth/${provider}/callback?code=abc&state=${state}`), ctx({ provider }));
  return { state, res, location: res.headers.get("location") ?? "" };
}

const linkedinHandlers = (): [string, Handler][] => [
  ["https://www.linkedin.com/oauth/v2/accessToken", () => j({ access_token: "li-access-1", expires_in: 5184000, scope: "openid profile w_member_social" })],
  ["https://api.linkedin.com/v2/userinfo", () => j({ sub: "abc123", name: "Dr Mehta" })],
];

async function approvedPost(t: T) {
  actAs(t.owner);
  const id = ((await json(await postsRoute.POST(post({ title: "Diwali health checkup offer", brief: "Checkup at Rs 999 in Shimla.", city: "Shimla" }), ctx(t.O)))).body.post as { id: string }).id;
  await mediaRoute.POST(post({ name: "a.png", image: PNG }), ctx({ ...t.O, postId: id }));
  await generateRoute.POST(post({}), ctx({ ...t.O, postId: id }));
  expect((await json(await statusRoute.POST(post({ action: "approve" }), ctx({ ...t.O, postId: id })))).status).toBe(200);
  return id;
}
const publishNow = async (t: T, id: string, channels: string[]) => json(await publishRoute.POST(post({ channels }), ctx({ ...t.O, postId: id })));

describe("OnePost connections: sign-in is owner-only, one-time and stored encrypted", () => {
  it("only owners can connect; an unconfigured provider says what is missing", async () => {
    const t = await tenant();
    actAs(t.manager);
    expect((await json(await startRoute.POST(post({}), ctx({ ...t.O, provider: "linkedin" })))).status).toBe(403);
    actAs(t.owner);
    vi.stubEnv("LINKEDIN_CLIENT_ID", "");
    const r = await json(await startRoute.POST(post({}), ctx({ ...t.O, provider: "linkedin" })));
    expect(r.status).toBe(503);
    expect(String(r.body.error)).toMatch(/LINKEDIN_CLIENT_ID/);
    expect((await json(await startRoute.POST(post({}), ctx({ ...t.O, provider: "myspace" })))).status).toBe(404);
  });

  it("builds the LinkedIn address with our redirect, scope and a one-time state that is stored only as a hash", async () => {
    const t = await tenant();
    actAs(t.owner);
    const r = await json(await startRoute.POST(post({}), ctx({ ...t.O, provider: "linkedin" })));
    const u = new URL(String(r.body.url));
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(u.searchParams.get("client_id")).toBe("li-client");
    expect(u.searchParams.get("redirect_uri")).toMatch(/\/api\/onepost\/oauth\/linkedin\/callback$/);
    expect(u.searchParams.get("scope")).toBe("openid profile w_member_social");
    const state = u.searchParams.get("state")!;
    expect(state.length).toBeGreaterThan(30);
    const row = await db.onePostOAuthState.findUniqueOrThrow({ where: { stateHash: sha256(state) } });
    expect(row.organizationId).toBe(t.org.id);
    expect(JSON.stringify(row)).not.toContain(state);
  });

  it("completes LinkedIn once, stores tokens encrypted, never returns them, and refuses a replay or another person's state", async () => {
    const t = await tenant();
    mockFetch(linkedinHandlers());
    const s = await signIn(t, "linkedin");
    expect(s.res.status).toBe(302);
    expect(s.location).toMatch(/connected=linkedin/);
    const row = await db.onePostConnection.findFirstOrThrow({ where: { organizationId: t.org.id } });
    expect(row.status).toBe("active");
    expect(row.externalId).toBe("urn:li:person:abc123");
    expect(row.encryptedAccess).not.toContain("li-access-1");
    expect(decryptSecret(row.encryptedAccess)).toBe("li-access-1");

    const list = await json(await connectionsRoute.GET(req("/x"), ctx(t.O)));
    expect(JSON.stringify(list.body)).not.toMatch(/li-access-1|encrypted/i);
    expect((list.body.connections as { name: string }[])[0].name).toMatch(/Dr Mehta/);
    expect((list.body.configured as Record<string, boolean>).linkedin).toBe(true);

    // The same link can't be used twice.
    const replay = await callbackRoute.GET(new Request(`http://localhost:3000/x?code=abc&state=${s.state}`), ctx({ provider: "linkedin" }));
    expect(replay.headers.get("location")).toMatch(/error=/);

    // Another signed-in person can't finish a sign-in they didn't start.
    actAs(t.owner);
    const st = await json(await startRoute.POST(post({}), ctx({ ...t.O, provider: "linkedin" })));
    const state2 = new URL(String(st.body.url)).searchParams.get("state")!;
    actAs(t.manager);
    const stolen = await callbackRoute.GET(new Request(`http://localhost:3000/x?code=abc&state=${state2}`), ctx({ provider: "linkedin" }));
    expect(stolen.headers.get("location")).toMatch(/error=/);
    expect(await db.onePostConnection.count({ where: { organizationId: t.org.id } })).toBe(1);

    // Cancelled at the provider: a friendly message, nothing saved.
    const denied = await callbackRoute.GET(new Request("http://localhost:3000/x?error=access_denied&state=x"), ctx({ provider: "linkedin" }));
    expect(decodeURIComponent(denied.headers.get("location") ?? "")).toMatch(/cancelled/i);
  });

  it("keeps connections private to their workspace", async () => {
    const a = await tenant();
    const b = await tenant();
    mockFetch(linkedinHandlers());
    await signIn(a, "linkedin");
    const id = (await db.onePostConnection.findFirstOrThrow({ where: { organizationId: a.org.id } })).id;
    actAs(b.owner);
    expect(((await json(await connectionsRoute.GET(req("/x"), ctx(b.O)))).body.connections as unknown[]).length).toBe(0);
    expect((await json(await connectionRoute.DELETE(req("/x", { method: "DELETE" }), ctx({ ...b.O, id })))).status).toBe(404);
    expect((await json(await targetsRoute.GET(req("/x"), ctx({ ...b.O, id })))).status).toBe(404);
    expect(await db.onePostConnection.count({ where: { id } })).toBe(1);
  });
});

describe("OnePost LinkedIn publishing", () => {
  it("uploads the photo, posts as the connected profile with markup escaped, and records the post link", async () => {
    const t = await tenant();
    mockFetch([
      ...linkedinHandlers(),
      ["https://test.public.blob.vercel-storage.com/", () => new Response(new Uint8Array([137, 80, 78, 71]))],
      ["https://api.linkedin.com/rest/images?action=initializeUpload", () => j({ value: { uploadUrl: "https://upload.linkedin.test/u1", image: "urn:li:image:77" } })],
      ["https://upload.linkedin.test/u1", () => new Response(null, { status: 201 })],
      ["https://api.linkedin.com/rest/posts", () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:99" } })],
    ]);
    await signIn(t, "linkedin");
    const id = await approvedPost(t);
    const r = await publishNow(t, id, ["linkedin"]);
    expect(r.status).toBe(200);
    const d = await db.onePostDelivery.findFirstOrThrow({ where: { postId: id } });
    expect(d.status).toBe("published");
    expect(d.externalUrl).toBe("https://www.linkedin.com/feed/update/urn:li:share:99");
    const create = calls.find((c) => c.url === "https://api.linkedin.com/rest/posts")!;
    const sent = JSON.parse(create.body);
    expect(sent.author).toBe("urn:li:person:abc123");
    expect(sent.content.media.id).toBe("urn:li:image:77");
    expect(sent.lifecycleState).toBe("PUBLISHED");
    expect(create.headers.authorization).toBe("Bearer li-access-1");
    expect(create.headers["linkedin-version"]).toMatch(/^\d{6}$/);
    expect(create.headers["x-restli-protocol-version"]).toBe("2.0.0");
  });

  it("renews an expiring token with the refresh token, and asks to reconnect when it can't", async () => {
    const t = await tenant();
    mockFetch([
      ...linkedinHandlers(),
      ["https://api.linkedin.com/rest/images?action=initializeUpload", () => j({ value: { uploadUrl: "https://upload.linkedin.test/u1", image: "urn:li:image:1" } })],
      ["https://upload.linkedin.test/", () => new Response(null, { status: 201 })],
      ["https://test.public.blob.vercel-storage.com/", () => new Response(new Uint8Array([1]))],
      ["https://api.linkedin.com/rest/posts", () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:5" } })],
    ]);
    await signIn(t, "linkedin");
    const conn = await db.onePostConnection.findFirstOrThrow({ where: { organizationId: t.org.id } });
    const { encryptSecret } = await import("@/lib/crypto");
    await db.onePostConnection.update({ where: { id: conn.id }, data: { expiresAt: new Date(Date.now() - 1000), encryptedRefresh: encryptSecret("refresh-1") } });
    mockFetch([
      ["https://www.linkedin.com/oauth/v2/accessToken", (_u, init) => {
        expect(String(init.body)).toContain("grant_type=refresh_token");
        return j({ access_token: "li-access-2", expires_in: 5184000 });
      }],
      ["https://api.linkedin.com/rest/images?action=initializeUpload", () => j({ value: { uploadUrl: "https://upload.linkedin.test/u1", image: "urn:li:image:1" } })],
      ["https://upload.linkedin.test/", () => new Response(null, { status: 201 })],
      ["https://test.public.blob.vercel-storage.com/", () => new Response(new Uint8Array([1]))],
      ["https://api.linkedin.com/rest/posts", () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:5" } })],
    ]);
    const id = await approvedPost(t);
    expect((await publishNow(t, id, ["linkedin"])).status).toBe(200);
    expect(calls.find((c) => c.url === "https://api.linkedin.com/rest/posts")!.headers.authorization).toBe("Bearer li-access-2");

    // Expired with no refresh token: no retry loop, a plain "reconnect" message.
    await db.onePostConnection.update({ where: { id: conn.id }, data: { expiresAt: new Date(Date.now() - 1000), encryptedRefresh: "" } });
    const id2 = await approvedPost(t);
    await publishNow(t, id2, ["linkedin"]);
    const d = await db.onePostDelivery.findFirstOrThrow({ where: { postId: id2 } });
    expect(d.status).toBe("failed");
    expect(d.attempts).toBe(1);
    expect(d.error).toMatch(/reconnect/i);
    expect((await db.onePostConnection.findUniqueOrThrow({ where: { id: conn.id } })).status).toBe("expired");
  });

  it("shows LinkedIn's own reason when it refuses the post, without retrying a permanent error", async () => {
    const t = await tenant();
    mockFetch([
      ...linkedinHandlers(),
      ["https://api.linkedin.com/rest/images?action=initializeUpload", () => j({ message: "Not enough permissions to access: images.initializeUpload" }, 403)],
      ["https://test.public.blob.vercel-storage.com/", () => new Response(new Uint8Array([1]))],
    ]);
    await signIn(t, "linkedin");
    const id = await approvedPost(t);
    await publishNow(t, id, ["linkedin"]);
    const d = await db.onePostDelivery.findFirstOrThrow({ where: { postId: id } });
    expect(d.status).toBe("failed");
    expect(d.error).toMatch(/Not enough permissions/);
  });
});

describe("OnePost Google Business Profile", () => {
  it("needs a location to be chosen, then posts a What's-new update with the photo and button", async () => {
    const t = await tenant();
    mockFetch([
      ["https://oauth2.googleapis.com/token", () => j({ access_token: "g-access-1", refresh_token: "g-refresh-1", expires_in: 3600, scope: "https://www.googleapis.com/auth/business.manage" })],
      ["https://mybusinessaccountmanagement.googleapis.com/v1/accounts", () => j({ accounts: [{ name: "accounts/111", accountName: "Mehta Clinic" }] })],
      ["https://mybusinessbusinessinformation.googleapis.com/v1/accounts/111/locations", () => j({ locations: [{ name: "locations/222", title: "Mehta Clinic Shimla" }] })],
      ["https://mybusiness.googleapis.com/v4/accounts/111/locations/222/localPosts", () => j({ name: "accounts/111/locations/222/localPosts/9", searchUrl: "https://www.google.com/search?q=mehta" })],
    ]);
    await signIn(t, "gbp");
    const conn = await db.onePostConnection.findFirstOrThrow({ where: { organizationId: t.org.id } });
    expect(conn.status).toBe("needs_target");
    expect(decryptSecret(conn.encryptedRefresh)).toBe("g-refresh-1");

    const id = await approvedPost(t);
    const early = await publishNow(t, id, ["gbp"]);
    expect(early.status).toBe(400);
    expect(JSON.stringify(early.body)).toMatch(/Choose which business location/);

    actAs(t.owner);
    const targets = await json(await targetsRoute.GET(req("/x"), ctx({ ...t.O, id: conn.id })));
    expect(targets.body.targets).toEqual([{ id: "accounts/111/locations/222", name: "Mehta Clinic Shimla (Mehta Clinic)" }]);
    expect((await json(await targetsRoute.PUT(post({ targetId: "accounts/999/locations/1" }, "PUT"), ctx({ ...t.O, id: conn.id })))).status).toBe(400);
    expect((await json(await targetsRoute.PUT(post({ targetId: "accounts/111/locations/222" }, "PUT"), ctx({ ...t.O, id: conn.id })))).status).toBe(200);

    // The demo Google version has a Learn more button with the business website; make sure it has a link.
    await db.onePostVersion.updateMany({ where: { postId: id, channel: "gbp" }, data: { content: JSON.stringify({ text: "Checkup offer at Mehta Clinic.", cta: "BOOK", ctaUrl: "https://mehtaclinic.example/book" }) } });
    const ok = await publishNow(t, id, ["gbp"]);
    expect(ok.status).toBe(200);
    const sent = JSON.parse(calls.find((c) => c.url.endsWith("/localPosts"))!.body);
    expect(sent.summary).toBe("Checkup offer at Mehta Clinic.");
    expect(sent.callToAction).toEqual({ actionType: "BOOK", url: "https://mehtaclinic.example/book" });
    expect(sent.media[0].sourceUrl).toMatch(/^https:\/\/test\.public\.blob\.vercel-storage\.com\//);
    expect(sent.languageCode).toBe("en-IN");
    const d = await db.onePostDelivery.findFirstOrThrow({ where: { postId: id } });
    expect(d).toMatchObject({ status: "published", externalUrl: "https://www.google.com/search?q=mehta" });
  });
});

describe("OnePost WordPress", () => {
  const wpOk = (extra: [string, Handler][] = []): [string, Handler][] => [
    ["https://blog.example.com/wp-json/wp/v2/users/me", () => j({ id: 5, name: "Editor" })],
    ["https://blog.example.com/wp-json/wp/v2/media", () => j({ id: 41 })],
    ["https://blog.example.com/wp-json/wp/v2/posts", () => j({ id: 77, link: "https://blog.example.com/diwali-checkup/" })],
    ["https://blog.example.com/wp-json/", () => j({ name: "Mehta Clinic Blog" })],
    ["https://test.public.blob.vercel-storage.com/", () => new Response(new Uint8Array([137, 80, 78, 71]))],
    ...extra,
  ];

  it("refuses internal, non-https and unresolvable addresses (no server-side request forgery)", async () => {
    const t = await tenant();
    mockFetch(wpOk());
    actAs(t.owner);
    for (const site of ["https://127.0.0.1", "https://localhost", "https://192.168.1.10", "https://169.254.169.254", "http://blog.example.com"]) {
      const r = await json(await wpRoute.POST(post({ site, username: "u", appPassword: "abcd efgh ijkl mnop" }), ctx(t.O)));
      expect(r.status, site).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("connects with an Application Password (stored encrypted), rejects a wrong one, and publishes the blog as a draft or live", async () => {
    const t = await tenant();
    mockFetch(wpOk());
    actAs(t.owner);
    const c = await json(await wpRoute.POST(post({ site: "blog.example.com/", username: "editor", appPassword: "abcd efgh ijkl mnop", status: "draft" }), ctx(t.O)));
    expect(c.status).toBe(201);
    const row = await db.onePostConnection.findFirstOrThrow({ where: { organizationId: t.org.id } });
    expect(row.externalId).toBe("https://blog.example.com");
    expect(row.encryptedAccess).not.toContain("abcd");
    expect(decryptSecret(row.encryptedAccess)).toBe("editor:abcd efgh ijkl mnop");
    expect(JSON.stringify(c.body)).not.toContain("abcd");

    const id = await approvedPost(t);
    await db.onePostVersion.updateMany({ where: { postId: id, channel: "blog" }, data: { content: JSON.stringify({ headline: "Diwali checkup <b>offer</b>", seoTitle: "Diwali checkup", metaDescription: "A checkup for Diwali.", slug: "diwali-checkup", body: "## Why now\n\nBook early. <script>alert(1)</script>", faq: [{ q: "Cost?", a: "Rs 999 & more" }] }) } });
    expect((await publishNow(t, id, ["wordpress"])).status).toBe(200);
    const created = calls.find((x) => x.url === "https://blog.example.com/wp-json/wp/v2/posts")!;
    const sent = JSON.parse(created.body);
    expect(sent.status).toBe("draft");
    expect(sent.slug).toBe("diwali-checkup");
    expect(sent.featured_media).toBe(41);
    expect(sent.content).toContain("<h2");
    expect(sent.content).not.toContain("<script>");
    expect(sent.content).toContain("Rs 999 &amp; more");
    expect(created.headers.authorization).toBe(`Basic ${Buffer.from("editor:abcd efgh ijkl mnop").toString("base64")}`);
    expect((await db.onePostDelivery.findFirstOrThrow({ where: { postId: id } })).externalUrl).toBe("https://blog.example.com/diwali-checkup/");

    // A wrong password is a clear message, and nothing is saved.
    mockFetch([["https://blog.example.com/wp-json/wp/v2/users/me", () => j({ code: "incorrect_password", message: "The provided password is an invalid application password." }, 401)]]);
    const t2 = await tenant();
    actAs(t2.owner);
    const w = await json(await wpRoute.POST(post({ site: "blog.example.com", username: "editor", appPassword: "wrong wrong wrong" }), ctx(t2.O)));
    expect(w.status).toBe(400);
    expect(String(w.body.error)).toMatch(/Application Password/);
    expect(await db.onePostConnection.count({ where: { organizationId: t2.org.id } })).toBe(0);
  });

  it("disconnecting cancels anything still queued for that account", async () => {
    const t = await tenant();
    mockFetch(wpOk());
    actAs(t.owner);
    await wpRoute.POST(post({ site: "blog.example.com", username: "editor", appPassword: "abcd efgh ijkl mnop" }), ctx(t.O));
    const conn = await db.onePostConnection.findFirstOrThrow({ where: { organizationId: t.org.id } });
    const id = await approvedPost(t);
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect((await json(await publishRoute.POST(post({ channels: ["wordpress"], scheduledAt: later }), ctx({ ...t.O, postId: id })))).status).toBe(200);
    actAs(t.manager);
    expect((await json(await connectionRoute.DELETE(req("/x", { method: "DELETE" }), ctx({ ...t.O, id: conn.id })))).status).toBe(403);
    actAs(t.owner);
    expect((await json(await connectionRoute.DELETE(req("/x", { method: "DELETE" }), ctx({ ...t.O, id: conn.id })))).status).toBe(200);
    expect((await db.onePostDelivery.findFirstOrThrow({ where: { postId: id } })).status).toBe("cancelled");
    expect((await db.onePost.findUniqueOrThrow({ where: { id } })).status).toBe("approved");
  });
});
