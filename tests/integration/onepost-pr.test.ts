import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, req } from "../helpers";
import * as contactsRoute from "@/app/api/organizations/[orgId]/onepost/pr/contacts/route";
import * as contactRoute from "@/app/api/organizations/[orgId]/onepost/pr/contacts/[contactId]/route";
import * as importRoute from "@/app/api/organizations/[orgId]/onepost/pr/contacts/import/route";
import * as releasesRoute from "@/app/api/organizations/[orgId]/onepost/pr/releases/route";
import * as exportRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/press/export/route";
import * as pitchesRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/pitches/route";
import * as pitchRoute from "@/app/api/organizations/[orgId]/onepost/posts/[postId]/pitches/[pitchId]/route";
import * as seoRoute from "@/app/api/organizations/[orgId]/onepost/seo/route";
import * as reportRoute from "@/app/api/organizations/[orgId]/onepost/reports/route";
import * as reportPdfRoute from "@/app/api/organizations/[orgId]/onepost/reports/pdf/route";
import * as openRoute from "@/app/api/onepost/p/[token]/open/route";
import * as unsubRoute from "@/app/api/onepost/unsub/[token]/route";
import { encryptSecret } from "@/lib/crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jj = async (r: Response) => (await json(r)) as { status: number; body: any };
const ctx = <X extends Record<string, string>>(p: X) => ({ params: Promise.resolve(p) });
const body = (b: unknown, method = "POST") => req("/x", { method, body: b });
const get = (u = "/x") => req(u);

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "MECGURA <press@example.com>");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

let n = 0;
async function tenant() {
  const org = await makeOrg(`PR ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, agent.id, "AGENT");
  await db.organizationService.create({ data: { organizationId: org.id, service: "ONEPOST", enabled: true } });
  return { org, owner, agent, O: { orgId: org.id } };
}
type T = Awaited<ReturnType<typeof tenant>>;

const release = { headline: "Mehta Clinic opens free health camp", subheadline: "200 families expected", dateline: "SHIMLA, India - 5 December 2026", body: "Mehta Clinic will host a free health camp.\n\nIt is open to all.", quoteText: "We want everyone to be healthy.", quoteBy: "Dr Mehta", boilerplate: "Mehta Clinic serves Shimla.", contactName: "Asha", contactEmail: "asha@example.com", contactPhone: "9999999999" };
async function approvedPost(t: T, status = "approved") {
  const post = await db.onePost.create({ data: { organizationId: t.org.id, title: "Health camp", status, approvedAt: status === "approved" ? new Date() : null } });
  await db.onePostVersion.create({ data: { organizationId: t.org.id, postId: post.id, channel: "press_release", content: JSON.stringify(release) } });
  await db.onePostVersion.create({ data: { organizationId: t.org.id, postId: post.id, channel: "pitch_email", content: JSON.stringify({ subject: "Free health camp in Shimla", body: "Hello,\n\nWe are hosting a free camp. Happy to arrange an interview." }) } });
  return post;
}
async function addContact(t: T, email = "reporter@news.example", name = "Ravi Kumar") {
  actAs(t.owner);
  const r = await jj(await contactsRoute.POST(body({ name, outlet: "Shimla Times", email, city: "Shimla", beat: "Health" }), ctx(t.O)));
  expect(r.status).toBe(201);
  return r.body as { id: string };
}
const mockResend = (ok = true) => {
  const f = vi.fn(async () => new Response(ok ? "{}" : "{}", { status: ok ? 200 : 500 }));
  vi.stubGlobal("fetch", f);
  return f;
};

describe("OnePost PR: media contacts", () => {
  it("adds, edits, lists and deletes contacts; refuses duplicates and bad emails", async () => {
    const t = await tenant();
    const c = await addContact(t);
    actAs(t.owner);
    expect((await jj(await contactsRoute.POST(body({ name: "Dup", email: "REPORTER@news.example" }), ctx(t.O)))).status).toBe(409);
    expect((await jj(await contactsRoute.POST(body({ name: "Bad", email: "nope" }), ctx(t.O)))).status).toBe(400);
    const patched = await jj(await contactRoute.PATCH(body({ name: "Ravi K", outlet: "Tribune", email: "reporter@news.example" }, "PATCH"), ctx({ ...t.O, contactId: c.id })));
    expect(patched.status).toBe(200);
    expect((await jj(await contactsRoute.GET(get(), ctx(t.O)))).body.contacts).toHaveLength(1);
    expect((await jj(await contactRoute.DELETE(body({}, "DELETE"), ctx({ ...t.O, contactId: c.id })))).status).toBe(200);
    expect((await jj(await contactsRoute.GET(get(), ctx(t.O)))).body.contacts).toHaveLength(0);
  });

  it("imports a CSV (quoted commas, duplicates update, bad rows reported)", async () => {
    const t = await tenant();
    actAs(t.owner);
    const csv = 'name,outlet,email,city,beat\nAnu Sharma,"Times, Shimla",anu@news.example,Shimla,Health\nBob,Daily,bob-not-email,,\nAnu S,Daily Post,anu@news.example,,\n';
    const r = await jj(await importRoute.POST(body({ csv }), ctx(t.O)));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ added: 1, updated: 1 });
    expect(r.body.skipped).toHaveLength(1);
    const rows = await db.onePostContact.findMany({ where: { organizationId: t.org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].outlet).toBe("Daily Post");
    expect((await jj(await importRoute.POST(body({ csv: "foo,bar\n1,2" }), ctx(t.O)))).status).toBe(400);
  });

  it("agents can read contacts but not change them; another workspace sees none", async () => {
    const t = await tenant();
    const c = await addContact(t);
    actAs(t.agent);
    expect((await jj(await contactsRoute.GET(get(), ctx(t.O)))).status).toBe(200);
    expect((await jj(await contactsRoute.POST(body({ name: "X Y", email: "x@y.example" }), ctx(t.O)))).status).toBe(403);
    const other = await tenant();
    actAs(other.owner);
    expect((await jj(await contactsRoute.GET(get(), ctx(other.O)))).body.contacts).toHaveLength(0);
    expect((await jj(await contactRoute.DELETE(body({}, "DELETE"), ctx({ ...other.O, contactId: c.id })))).status).toBe(404);
  });
});

describe("OnePost PR: releases and exports", () => {
  it("lists releases and exports DOCX and PDF; Hindi text can't go to PDF but works in DOCX", async () => {
    const t = await tenant();
    const post = await approvedPost(t);
    actAs(t.owner);
    const list = await jj(await releasesRoute.GET(get(), ctx(t.O)));
    expect(list.body.releases).toHaveLength(1);
    expect(list.body.releases[0].headline).toBe(release.headline);
    const pdf = await exportRoute.GET(get("/x?format=pdf"), ctx({ ...t.O, postId: post.id }));
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    const docx = await exportRoute.GET(get("/x?format=docx"), ctx({ ...t.O, postId: post.id }));
    expect(Buffer.from(await docx.arrayBuffer()).subarray(0, 2).toString()).toBe("PK");
    await db.onePostVersion.update({ where: { postId_channel: { postId: post.id, channel: "press_release" } }, data: { content: JSON.stringify({ ...release, headline: "स्वास्थ्य शिविर" }) } });
    expect((await exportRoute.GET(get("/x?format=pdf"), ctx({ ...t.O, postId: post.id }))).status).toBe(400);
    expect((await exportRoute.GET(get("/x?format=docx"), ctx({ ...t.O, postId: post.id }))).status).toBe(200);
  });
});

describe("OnePost PR: pitch emails", () => {
  it("sends only after approval, tracks opens, records coverage, never repeats", async () => {
    const t = await tenant();
    const c = await addContact(t);
    const draft = await approvedPost(t, "draft");
    actAs(t.owner);
    const f = mockResend();
    expect((await jj(await pitchesRoute.POST(body({ contactIds: [c.id] }), ctx({ ...t.O, postId: draft.id })))).status).toBe(409);
    expect(f).not.toHaveBeenCalled();

    const post = await approvedPost(t);
    const sent = await jj(await pitchesRoute.POST(body({ contactIds: [c.id] }), ctx({ ...t.O, postId: post.id })));
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ sent: 1, failed: 0 });
    const mail = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(mail.to).toEqual(["reporter@news.example"]);
    expect(mail.text).toContain("Hello Ravi,");
    expect(mail.text).toContain(release.headline);
    expect(mail.headers["List-Unsubscribe"]).toMatch(/\/api\/onepost\/unsub\//);
    expect(mail.html).toMatch(/\/api\/onepost\/p\/.+\/open/);

    const again = await jj(await pitchesRoute.POST(body({ contactIds: [c.id] }), ctx({ ...t.O, postId: post.id })));
    expect(again.body).toMatchObject({ sent: 0 });
    expect(again.body.skipped[0].reason).toMatch(/Already/);
    expect(f).toHaveBeenCalledTimes(1);

    const pitch = await db.onePostPitch.findFirstOrThrow({ where: { postId: post.id } });
    const px = await openRoute.GET(get(), ctx({ token: pitch.trackToken }));
    expect(px.headers.get("content-type")).toBe("image/gif");
    await openRoute.GET(get(), ctx({ token: pitch.trackToken }));
    const after = await db.onePostPitch.findFirstOrThrow({ where: { id: pitch.id } });
    expect(after.openCount).toBe(2);
    expect(after.openedAt).not.toBeNull();
    expect((await openRoute.GET(get(), ctx({ token: "nonsense" }))).status).toBe(200);

    expect((await jj(await pitchRoute.PATCH(body({ coverageUrl: "http://bad", coverageNote: "" }, "PATCH"), ctx({ ...t.O, postId: post.id, pitchId: pitch.id })))).status).toBe(400);
    expect((await jj(await pitchRoute.PATCH(body({ coverageUrl: "https://news.example/story", coverageNote: "Page 3" }, "PATCH"), ctx({ ...t.O, postId: post.id, pitchId: pitch.id })))).status).toBe(200);
    const list = await jj(await pitchesRoute.GET(get(), ctx({ ...t.O, postId: post.id })));
    expect(list.body.pitches[0]).toMatchObject({ status: "sent", coverageUrl: "https://news.example/story", openCount: 2 });
  });

  it("is refused when email isn't configured, and failures are recorded", async () => {
    const t = await tenant();
    const c = await addContact(t);
    const post = await approvedPost(t);
    actAs(t.owner);
    vi.stubEnv("RESEND_API_KEY", "");
    expect((await jj(await pitchesRoute.POST(body({ contactIds: [c.id] }), ctx({ ...t.O, postId: post.id })))).status).toBe(503);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    mockResend(false);
    const r = await jj(await pitchesRoute.POST(body({ contactIds: [c.id] }), ctx({ ...t.O, postId: post.id })));
    expect(r.body).toMatchObject({ sent: 0, failed: 1 });
    expect((await db.onePostPitch.findFirstOrThrow({ where: { postId: post.id } })).status).toBe("failed");
  });

  it("unsubscribing needs a confirm step and then stops all future pitches", async () => {
    const t = await tenant();
    const c = await addContact(t);
    const row = await db.onePostContact.findFirstOrThrow({ where: { id: c.id } });
    const page = await unsubRoute.GET(get(), ctx({ token: row.optToken }));
    expect(await page.text()).toContain("Unsubscribe me");
    expect((await db.onePostContact.findFirstOrThrow({ where: { id: c.id } })).optedOut).toBe(false);
    expect((await unsubRoute.POST(req("/x", { method: "POST", body: {} }), ctx({ token: row.optToken }))).status).toBe(200);
    expect((await db.onePostContact.findFirstOrThrow({ where: { id: c.id } })).optedOut).toBe(true);
    expect((await unsubRoute.GET(get(), ctx({ token: "bogus-bogus-bogus-bogus" }))).status).toBe(404);
    const post = await approvedPost(t);
    const f = mockResend();
    actAs(t.owner);
    const r = await jj(await pitchesRoute.POST(body({ contactIds: [c.id] }), ctx({ ...t.O, postId: post.id })));
    expect(r.body.sent).toBe(0);
    expect(r.body.skipped[0].reason).toMatch(/not to be contacted/);
    expect(f).not.toHaveBeenCalled();
  });

  it("can't pitch another workspace's post or contacts", async () => {
    const a = await tenant();
    const b = await tenant();
    const ca = await addContact(a);
    const pb = await approvedPost(b);
    mockResend();
    actAs(b.owner);
    const r = await jj(await pitchesRoute.POST(body({ contactIds: [ca.id] }), ctx({ ...b.O, postId: pb.id })));
    expect(r.body.sent).toBe(0);
    actAs(a.owner);
    expect((await jj(await pitchesRoute.POST(body({ contactIds: [ca.id] }), ctx({ ...a.O, postId: pb.id })))).status).toBe(404);
  });
});

describe("OnePost SEO and monthly report", () => {
  it("says plainly when Search Console isn't connected", async () => {
    const t = await tenant();
    actAs(t.owner);
    const r = await jj(await seoRoute.GET(get("/x?days=28"), ctx(t.O)));
    expect(r.body.available).toBe(false);
    expect(r.body.note).toMatch(/not connected/);
    expect((await jj(await seoRoute.GET(get("/x?days=3"), ctx(t.O)))).status).toBe(400);
  });

  it("reads clicks and keywords from a connected Search Console site", async () => {
    const t = await tenant();
    await db.onePostConnection.create({ data: { organizationId: t.org.id, provider: "gsc", status: "active", encryptedAccess: encryptSecret("tok"), expiresAt: new Date(Date.now() + 3600_000), externalId: "sc-domain:example.com", externalName: "example.com" } });
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body ?? "{}"));
      const rows = b.dimensions?.[0] === "query" ? [{ keys: ["health camp shimla"], clicks: 12, impressions: 300, ctr: 0.04, position: 6.2 }] : b.dimensions?.[0] === "page" ? [{ keys: ["https://example.com/camp"], clicks: 9, impressions: 200, ctr: 0.045, position: 5 }] : [{ clicks: 12, impressions: 300, ctr: 0.04, position: 6.2 }];
      return new Response(JSON.stringify({ rows }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    actAs(t.owner);
    const r = await jj(await seoRoute.GET(get("/x?days=28"), ctx(t.O)));
    expect(r.body.available).toBe(true);
    expect(r.body.data.queries[0].key).toBe("health camp shimla");
  });

  it("builds a month report with counts, links and PR numbers, and a PDF", async () => {
    const t = await tenant();
    const post = await approvedPost(t);
    const now = new Date();
    await db.onePostDelivery.create({ data: { organizationId: t.org.id, postId: post.id, channel: "linkedin", status: "published", scheduledAt: now, nextAttemptAt: now, publishedAt: now, externalUrl: "https://linkedin.example/p/1" } });
    await db.onePostDelivery.create({ data: { organizationId: t.org.id, postId: post.id, channel: "facebook", status: "failed", scheduledAt: now, nextAttemptAt: now, error: "x" } });
    const month = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 7);
    actAs(t.owner);
    const r = await jj(await reportRoute.GET(get(`/x?month=${month}`), ctx(t.O)));
    expect(r.status).toBe(200);
    expect(r.body.posts.created).toBe(1);
    expect(r.body.published).toEqual([{ channel: "linkedin", label: "LinkedIn", count: 1 }]);
    expect(r.body.failed).toBe(1);
    expect(r.body.search.available).toBe(false);
    const pdf = await reportPdfRoute.GET(get(`/x?month=${month}`), ctx(t.O));
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    expect((await jj(await reportRoute.GET(get("/x?month=2026-13"), ctx(t.O)))).status).toBe(400);
    const o = await tenant();
    actAs(o.owner);
    expect((await jj(await reportRoute.GET(get(`/x?month=${month}`), ctx(o.O)))).body.posts.created).toBe(0);
  });
});
