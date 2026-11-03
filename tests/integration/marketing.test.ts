import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, json, makePlan, makeUser, params, req } from "../helpers";
import * as leadsRoute from "@/app/api/admin/marketing/leads/route";
import * as leadRoute from "@/app/api/admin/marketing/leads/[id]/route";
import * as contactedRoute from "@/app/api/admin/marketing/leads/[id]/contacted/route";
import * as overviewRoute from "@/app/api/admin/marketing/overview/route";
import * as proofRoute from "@/app/api/admin/marketing/proof/route";
import * as postsRoute from "@/app/api/admin/marketing/posts/route";
import * as postRoute from "@/app/api/admin/marketing/posts/[id]/route";
import * as autoPlanRoute from "@/app/api/admin/marketing/posts/auto-plan/route";
import * as trackRoute from "@/app/api/m/track/route";
import * as clients from "@/app/api/admin/organizations/route";
import { heatScore, recordLead } from "@/services/marketing/leads";
import { sourceOf } from "@/lib/traffic-source";
import { captureWhatsAppLead, sourceFromText } from "@/services/marketing/capture";
import { setWaBot } from "@/services/site/lead-chat";
import { resetRateLimits } from "@/lib/rate-limit";

afterEach(() => vi.restoreAllMocks());

let n = 0;
const phone = () => `+9198${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;
const post = (body: unknown) => req("/x", { method: "POST", body });
const P = (id: string) => params({ id });

describe("marketing leads", () => {
  it("only the Super Admin can see or change marketing", async () => {
    actAs(await makeUser({ name: "Client" }));
    expect((await leadsRoute.GET(req("/x"))).status).toBe(403);
    expect((await overviewRoute.GET(req("/x"))).status).toBe(403);
    expect((await postsRoute.GET(req("/x?month=2026-11"))).status).toBe(403);
  });

  it("one lead per number: a returning person gets a note, a lost lead is reopened, admins are told about new ones", async () => {
    const admin = await makeUser({ role: "SUPER_ADMIN", name: "Admin" });
    const p = phone();
    const first = await recordLead({ phone: p.replace("+91", ""), name: "Aman", source: "website_chat", medium: "instagram", campaign: "diwali" });
    expect(first.created).toBe(true);
    expect(first.lead).toMatchObject({ phone: p, source: "website_chat", medium: "instagram", stage: "new" });
    expect(await db.notification.count({ where: { userId: admin.id, title: { contains: "Aman" } } })).toBe(1);

    await db.marketingLead.update({ where: { id: first.lead.id }, data: { stage: "lost", lostReason: "price" } });
    const again = await recordLead({ phone: p, source: "whatsapp", business: "Aman Sweets" });
    expect(again.created).toBe(false);
    expect(again.lead).toMatchObject({ stage: "new", business: "Aman Sweets", lostReason: "" });
    expect(again.lead.activities[0].text).toContain("reopened");
    expect(await db.marketingLead.count({ where: { phone: p } })).toBe(1);
  });

  it("heat: fresh warm-source leads that wait for a call come first; won and lost are fixed", () => {
    const now = Date.now();
    const fresh = heatScore({ source: "referral", stage: "new", createdAt: new Date(now - 3_600_000), lastContactAt: null, nextFollowUpAt: null }, now);
    const old = heatScore({ source: "manual", stage: "contacted", createdAt: new Date(now - 40 * 86_400_000), lastContactAt: new Date(now), nextFollowUpAt: null }, now);
    expect(fresh).toBeGreaterThan(60);
    expect(old).toBeLessThan(35);
    expect(heatScore({ source: "manual", stage: "won", createdAt: new Date(), lastContactAt: null, nextFollowUpAt: null })).toBe(100);
    expect(heatScore({ source: "referral", stage: "lost", createdAt: new Date(), lastContactAt: null, nextFollowUpAt: null })).toBe(0);
  });

  it("admin adds a lead, works it through the stages, follows up and onboarding the number marks it won", async () => {
    const admin = await makeUser({ role: "SUPER_ADMIN", name: "Admin" });
    actAs(admin);
    const p = phone();
    expect((await leadsRoute.POST(post({ phone: "12", name: "X" }))).status).toBe(400);
    const c = await json(await leadsRoute.POST(post({ phone: p, name: "Simran", business: "Simran Boutique", city: "Ludhiana", note: "Wants broadcast for new stock", valueRupees: 4999 })));
    expect(c.status).toBe(201);
    const id = (c.body.lead as { id: string }).id;

    // A new lead nobody has messaged is on today's list.
    const list = await json(await leadsRoute.GET(req("/x")));
    expect((list.body.today as { id: string }[]).some((l) => l.id === id)).toBe(true);

    const m = await json(await contactedRoute.POST(post({}), P(id)));
    expect(m.body.lead).toMatchObject({ stage: "contacted" });
    expect(String(m.body.followUp)).toContain("Simran");

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const u = await json(await leadRoute.PATCH(req("/x", { method: "PATCH", body: { stage: "demo", nextFollowUpAt: tomorrow, note: "Demo done, liked automations" } }), P(id)));
    expect(u.status).toBe(200);
    const kinds = (u.body.lead as { activities: { kind: string }[] }).activities.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["stage", "follow_up", "note", "whatsapp", "created"]));
    expect((await leadRoute.PATCH(req("/x", { method: "PATCH", body: { stage: "maybe" } }), P(id))).status).toBe(400);

    // Onboarding a client with the same mobile marks the lead won and links it.
    const plan = await makePlan({ priceMonthly: 499900 });
    const cl = await json(await clients.POST(post({ name: `Simran Boutique ${n++}`, ownerName: "Simran", ownerEmail: `simran-${Date.now()}@x.local`, ownerPassword: "Passw0rd!x", mobile: p, planId: plan.id, services: ["WHATSAPP_AUTOMATION"], sendAgreement: false })));
    expect(cl.status).toBe(201);
    const won = await db.marketingLead.findUniqueOrThrow({ where: { id } });
    expect(won.stage).toBe("won");
    expect(won.organizationId).toBe((cl.body.organization as { id: string }).id);

    expect((await leadRoute.DELETE(req("/x", { method: "DELETE" }), P(id))).status).toBe(200);
    expect(await db.marketingLeadActivity.count({ where: { leadId: id } })).toBe(0);
  });

  it("the first message to MECGURA's own number becomes a lead, credited by the pre-filled text", async () => {
    const admin = await makeUser({ role: "SUPER_ADMIN", name: "Admin" });
    const org = await db.organization.create({ data: { name: "MECGURA", slug: `mecgura-${Date.now()}` } });
    const acct = await db.whatsAppAccount.create({ data: { organizationId: org.id, displayName: "MECGURA", phoneNumber: phone(), status: "connected" } });
    const other = await db.whatsAppAccount.create({ data: { organizationId: org.id, displayName: "Other", phoneNumber: phone(), status: "connected" } });
    await setWaBot(acct.id, admin.id);
    const contact = await db.contact.create({ data: { organizationId: org.id, phone: phone(), name: "Rohit", optInStatus: "opted_in" } });
    const conv = await db.conversation.create({ data: { organizationId: org.id, contactId: contact.id, whatsappAccountId: acct.id } });
    await db.message.create({ data: { organizationId: org.id, conversationId: conv.id, direction: "inbound", type: "text", body: "Hi MECGURA, I would like a demo of the platform.", status: "received" } });

    expect(await captureWhatsAppLead({ conversationId: conv.id, contactId: contact.id, whatsappAccountId: other.id, text: "hi", optOut: false })).toBeNull();
    const r = await captureWhatsAppLead({ conversationId: conv.id, contactId: contact.id, whatsappAccountId: acct.id, text: "Hi MECGURA, I would like a demo of the platform.", optOut: false });
    expect(r?.lead).toMatchObject({ name: "Rohit", source: "demo_click" });
    expect(sourceFromText("I want the Diwali offer (code DIWALI20)")).toBe("festival");
    await setWaBot(null, admin.id);
  });
});

describe("website analytics", () => {
  it("works out the source from utm or the referring site", () => {
    expect(sourceOf("IG", "")).toBe("instagram");
    expect(sourceOf("", "https://l.facebook.com/l.php?u=x")).toBe("facebook");
    expect(sourceOf("", "https://www.google.co.in/")).toBe("google");
    expect(sourceOf("", "https://mecgura.tech/pricing", "mecgura.tech")).toBe("direct");
    expect(sourceOf("", "")).toBe("direct");
  });

  it("stores anonymous visits and clicks, drops junk, and the overview counts them", async () => {
    resetRateLimits();
    await db.marketingEvent.deleteMany({});
    const beacon = (body: unknown) => trackRoute.POST(new Request("http://localhost:3000/api/m/track", { method: "POST", headers: { "content-type": "text/plain", host: "mecgura.tech", "x-forwarded-for": "198.51.100.7" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
    expect((await beacon({ kind: "visit", path: "/?x=1", referrer: "https://www.instagram.com/", visitor: "abc12345" })).status).toBe(204);
    expect((await beacon({ kind: "visit", path: "/", utmSource: "google", utmCampaign: "brand", visitor: "def67890" })).status).toBe(204);
    expect((await beacon({ kind: "click", name: "demo_hero", path: "/", visitor: "abc12345" })).status).toBe(204);
    expect((await beacon("not json")).status).toBe(204);
    expect((await beacon({ kind: "visit", name: "DROP TABLE" })).status).toBe(204);
    const events = await db.marketingEvent.findMany({ orderBy: { createdAt: "asc" } });
    expect(events.map((e) => [e.kind, e.source, e.path])).toEqual([
      ["visit", "instagram", "/"],
      ["visit", "google", "/"],
      ["click", "direct", "/"],
    ]);

    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    const o = await json(await overviewRoute.GET(req("/x?days=7")));
    expect(o.status).toBe(200);
    expect(o.body.totals).toMatchObject({ visits: 2, visitors: 2, clicks: 1 });
    expect((o.body.series as { visits: number[] }).visits).toHaveLength(7);
    expect((await overviewRoute.GET(req("/x?days=12"))).status).toBe(400);
    const pr = await json(await proofRoute.GET(req("/x")));
    expect(pr.body).toHaveProperty("messagesSent");
  });
});

describe("content calendar", () => {
  it("adds, edits and deletes posts; auto-plan fills only empty days and adds festival posts", async () => {
    actAs(await makeUser({ role: "SUPER_ADMIN", name: "Admin" }));
    const month = "2031-03";
    await db.marketingPost.deleteMany({ where: { date: { startsWith: `${month}-` } } });
    expect((await postsRoute.POST(post({ date: "2031-03-03", title: "" }))).status).toBe(400);
    const c = await json(await postsRoute.POST(post({ date: "2031-03-03", title: "My launch post", caption: "Hello", channels: ["instagram", "facebook"] })));
    expect(c.status).toBe(201);
    const id = (c.body.post as { id: string }).id;

    const plan = await json(await autoPlanRoute.POST(post({ month })));
    expect(plan.status).toBe(200);
    const posts = plan.body.posts as { date: string; title: string }[];
    expect(plan.body.added).toBeGreaterThan(8);
    // 3 March 2031 is a Monday that already had a post: it was kept, not doubled.
    expect(posts.filter((p) => p.date === "2031-03-03").map((p) => p.title)).toEqual(["My launch post"]);
    const again = await json(await autoPlanRoute.POST(post({ month })));
    expect(again.body.added).toBe(0);

    const e = await json(await postRoute.PATCH(req("/x", { method: "PATCH", body: { status: "posted" } }), P(id)));
    expect(e.body.post).toMatchObject({ status: "posted", channels: ["instagram", "facebook"] });
    expect((await postRoute.DELETE(req("/x", { method: "DELETE" }), P(id))).status).toBe(200);
    expect((await postsRoute.GET(req(`/x?month=${month}`))).status).toBe(200);
    expect((await postsRoute.GET(req("/x?month=2031-13"))).status).toBe(400);
  });
});
