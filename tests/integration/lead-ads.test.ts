import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as templates from "@/app/api/organizations/[orgId]/templates/route";
import * as submit from "@/app/api/organizations/[orgId]/templates/[tid]/submit/route";
import * as review from "@/app/api/organizations/[orgId]/templates/[tid]/review/route";
import * as sources from "@/app/api/organizations/[orgId]/lead-sources/route";
import * as source from "@/app/api/organizations/[orgId]/lead-sources/[sid]/route";
import * as testLead from "@/app/api/organizations/[orgId]/lead-sources/[sid]/test/route";
import * as leadsList from "@/app/api/organizations/[orgId]/lead-sources/[sid]/leads/route";
import * as metaWebhook from "@/app/api/webhooks/meta/route";
import { creditWallet } from "@/services/wallet";
import { setPrices } from "@/services/wallet-pricing";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

let n = 0;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });
const TOKEN = () => `EAAG${"x".repeat(60)}${n}`;
const pageId = () => `10${String(Date.now()).slice(-9)}${n++}`;
const phone = () => `9${String(Date.now()).slice(-8)}${n++ % 10}`;

type Tenant = Awaited<ReturnType<typeof makeTenant>>;
async function makeTenant(opts: { live?: boolean } = {}) {
  const org = await makeOrg(`Leads ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 20, maxWhatsAppNumbers: 3 });
  await db.plan.update({ where: { id: plan.id }, data: { maxContacts: 10_000 } });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const d = await json(await demoConnect.POST(post({ businessName: "Demo Store" }), P(org.id)));
  const accountId = (d.body.account as { id: string }).id;
  const acct = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } });
  // An approved template with one variable (the lead's first name).
  const c = await json(await templates.POST(post({ wabaId: acct.wabaRecordId, language: "en", name: `lead_welcome_${n++}`, category: "MARKETING", body: "Hi {{1}}, thanks for your interest! We will message you shortly. Reply STOP to unsubscribe.", examples: { body: ["Priya"] } }), P(org.id)));
  expect(c.status).toBe(201);
  const templateId = (c.body.template as { id: string }).id;
  await submit.POST(post({}), P(org.id, { tid: templateId }));
  await review.POST(post({ decision: "approved" }), P(org.id, { tid: templateId }));
  if (opts.live) {
    const conn = await db.whatsAppConnection.create({ data: { organizationId: org.id, method: "manual", status: "active", encryptedAccessToken: encryptSecret("EAAGtesttoken") } });
    await db.whatsAppAccount.update({ where: { id: accountId }, data: { isDemo: false, status: "connected", phoneNumberId: `pn${Date.now()}${n}`, connectionId: conn.id } });
  }
  return { org, owner, agent, accountId, templateId };
}

const VARS = { "body.1": { source: "field", field: "first_name", fallback: "there" } };

function mockGraph(extra: (url: URL, method: string) => Response | null = () => null) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname !== "graph.facebook.com") throw new Error(`unexpected fetch ${url}`);
    const method = (init?.method ?? "GET").toUpperCase();
    const custom = extra(url, method);
    if (custom) return custom;
    const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const path = url.pathname.replace(/^\/v[\d.]+\//, "");
    if (path.endsWith("/subscribed_apps")) return reply({ success: true });
    if (path.endsWith("/messages")) return reply({ messages: [{ id: `wamid.${Math.random().toString(36).slice(2)}` }] });
    if (/^\d+$/.test(path)) return reply({ id: path, name: "Mecgura Page" });
    return reply({ error: { message: "Unknown path" } }, 404);
  });
}

async function connect(t: Tenant, over: Record<string, unknown> = {}) {
  actAs(t.owner);
  mockGraph();
  const body = { name: "Diwali leads", pageId: pageId(), pageAccessToken: TOKEN(), whatsappAccountId: t.accountId, templateId: t.templateId, variables: VARS, consentConfirmed: true, ...over };
  const r = await json(await sources.POST(post(body), P(t.org.id)));
  return { r, body, id: (r.body.source as { id: string } | undefined)?.id ?? "" };
}

describe("lead sources: setup", () => {
  it("connects a Page, verifies the token with Meta, stores it encrypted and never returns it", async () => {
    const t = await makeTenant();
    const { r, body } = await connect(t);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ webhookSubscribed: true, source: { pageId: body.pageId, status: "active", consentConfirmed: true } });
    expect(JSON.stringify(r.body)).not.toContain(body.pageAccessToken);
    const row = await db.leadSource.findFirstOrThrow({ where: { organizationId: t.org.id } });
    expect(row.encryptedPageToken).not.toContain("EAAG");
    expect(await db.auditLog.count({ where: { organizationId: t.org.id, action: "lead_source.connected" } })).toBe(1);
  });

  it("needs the owner's consent confirmation, a valid template mapping, an unused Page and a Page Meta accepts", async () => {
    const t = await makeTenant();
    actAs(t.owner);
    mockGraph();
    const base = { name: "x", pageId: pageId(), pageAccessToken: TOKEN(), whatsappAccountId: t.accountId, templateId: t.templateId, variables: VARS };
    expect((await sources.POST(post({ ...base, consentConfirmed: false }), P(t.org.id))).status).toBe(400);
    expect((await sources.POST(post({ ...base, variables: {}, consentConfirmed: true }), P(t.org.id))).status).toBe(400);
    expect((await sources.POST(post({ ...base, pageAccessToken: "short", consentConfirmed: true }), P(t.org.id))).status).toBe(400);
    expect((await sources.POST(post({ ...base, consentConfirmed: true, extra: 1 }), P(t.org.id))).status).toBe(400);
    expect((await sources.POST(post({ ...base, consentConfirmed: true }), P(t.org.id))).status).toBe(201);
    expect((await sources.POST(post({ ...base, consentConfirmed: true }), P(t.org.id))).status).toBe(409); // Page already connected

    mockGraph((url) => (/^\/v[\d.]+\/\d+$/.test(url.pathname) ? new Response(JSON.stringify({ error: { message: "Invalid OAuth access token." } }), { status: 400 }) : null));
    const rejected = await json(await sources.POST(post({ ...base, pageId: pageId(), consentConfirmed: true }), P(t.org.id)));
    expect(rejected.status).toBe(400);
    expect(String(rejected.body.error)).toContain("Invalid OAuth access token");
  });

  it("only owners connect or change sources; other workspaces can't use this workspace's number or template", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    actAs(a.agent);
    mockGraph();
    const body = { name: "x", pageId: pageId(), pageAccessToken: TOKEN(), whatsappAccountId: a.accountId, templateId: a.templateId, variables: VARS, consentConfirmed: true };
    expect((await sources.POST(post(body), P(a.org.id))).status).toBe(403);
    actAs(b.owner);
    expect([400, 404]).toContain((await sources.POST(post({ ...body, pageId: pageId() }), P(b.org.id))).status); // a's number and template aren't b's
    const made = await connect(a);
    actAs(b.owner);
    expect([403, 404]).toContain((await sources.GET(req("/x"), P(a.org.id))).status);
    expect((await source.PATCH(req("/x", { method: "PATCH", body: { status: "paused" } }), P(b.org.id, { sid: made.id }))).status).toBe(404);
    expect((await source.DELETE(req("/x", { method: "DELETE" }), P(b.org.id, { sid: made.id }))).status).toBe(404);
  });
});

describe("lead pipeline", () => {
  it("a test lead becomes a contact with recorded consent and gets the WhatsApp reply", async () => {
    const t = await makeTenant();
    const { id } = await connect(t);
    const ph = phone();
    const r = await json(await testLead.POST(post({ phone: ph, name: "Priya Sharma" }), P(t.org.id, { sid: id })));
    expect(r.status).toBe(200);
    expect(r.body.result).toMatchObject({ status: "messaged" });
    const contact = await db.contact.findFirstOrThrow({ where: { organizationId: t.org.id, phone: `+91${ph}` } });
    expect(contact).toMatchObject({ name: "Priya Sharma", source: "meta_lead_ad", lifecycle: "lead", optInStatus: "opted_in" });
    expect(await db.consentRecord.count({ where: { contactId: contact.id, source: "lead_form", status: "opted_in" } })).toBe(1);
    const msg = await db.message.findFirstOrThrow({ where: { organizationId: t.org.id, direction: "outbound", conversation: { contactId: contact.id } } });
    expect(msg).toMatchObject({ type: "template", status: "sent" });
    expect(msg.body).toContain("Hi Priya, thanks for your interest");
    expect(JSON.parse(msg.payload)).toMatchObject({ origin: "lead_ad" });
    const list = await json(await leadsList.GET(req("/x"), P(t.org.id, { sid: id })));
    expect((list.body.leads as { status: string; isTest: boolean }[])[0]).toMatchObject({ status: "messaged", isTest: true });
    // Test leads don't inflate the real lead counter.
    expect((await db.leadSource.findUniqueOrThrow({ where: { id } })).leadsCount).toBe(0);
  });

  it("skips (and says why) when there is no valid phone, or the contact opted out; an existing contact is reused", async () => {
    const t = await makeTenant();
    const { id } = await connect(t);
    expect((await json(await testLead.POST(post({ phone: "not a number", name: "X" }), P(t.org.id, { sid: id })))).body.result).toMatchObject({ status: "skipped", error: expect.stringMatching(/no valid phone/i) });

    const ph = phone();
    const out = await db.contact.create({ data: { organizationId: t.org.id, phone: `+91${ph}`, name: "Opted Out", optInStatus: "opted_out" } });
    const r = await json(await testLead.POST(post({ phone: ph, name: "Again" }), P(t.org.id, { sid: id })));
    expect(r.body.result).toMatchObject({ status: "skipped" });
    expect(await db.message.count({ where: { organizationId: t.org.id, direction: "outbound" } })).toBe(0);
    expect((await db.contact.findUniqueOrThrow({ where: { id: out.id } })).optInStatus).toBe("opted_out"); // never re-opted

    const ph2 = phone();
    const first = await db.contact.create({ data: { organizationId: t.org.id, phone: `+91${ph2}`, name: "Existing", optInStatus: "unknown" } });
    await testLead.POST(post({ phone: ph2, name: "Different Name" }), P(t.org.id, { sid: id }));
    expect(await db.contact.count({ where: { organizationId: t.org.id, phone: `+91${ph2}` } })).toBe(1);
    expect((await db.contact.findUniqueOrThrow({ where: { id: first.id } })).name).toBe("Existing");
  });

  it("a source without a template only saves the contact", async () => {
    const t = await makeTenant();
    const { id } = await connect(t, { templateId: null, variables: {} });
    const r = await json(await testLead.POST(post({ phone: phone(), name: "No Reply" }), P(t.org.id, { sid: id })));
    expect(r.body.result).toMatchObject({ status: "skipped", error: expect.stringMatching(/No reply template/) });
    expect(await db.contact.count({ where: { organizationId: t.org.id, source: "meta_lead_ad" } })).toBe(1);
  });

  it("with a message fee and an empty wallet the lead is saved but the reply is not sent", async () => {
    const t = await makeTenant({ live: true });
    const { id } = await connect(t);
    await setPrices(t.org.id, { marketing: 100 }, t.owner.id);
    mockGraph();
    const empty = await json(await testLead.POST(post({ phone: phone(), name: "Broke" }), P(t.org.id, { sid: id })));
    expect(empty.body.result).toMatchObject({ status: "failed", error: expect.stringMatching(/Wallet balance is too low/) });
    expect(await db.contact.count({ where: { organizationId: t.org.id, source: "meta_lead_ad" } })).toBe(1);

    await creditWallet(t.org.id, { actorUserId: t.owner.id }, { amount: 500 });
    const funded = await json(await testLead.POST(post({ phone: phone(), name: "Funded" }), P(t.org.id, { sid: id })));
    expect(funded.body.result).toMatchObject({ status: "messaged" });
    expect(await db.walletEntry.count({ where: { organizationId: t.org.id, reason: "usage" } })).toBe(1);
  });
});

describe("Meta page webhook (leadgen)", () => {
  const SECRET = "leadsecretleadsecretleadsecret123456";
  const sign = (body: object, secret = SECRET) => {
    const raw = JSON.stringify(body);
    return new Request("http://localhost:3000/api/webhooks/meta", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` }, body: raw });
  };
  const payload = (page: string, leadgenId: string, formId = "777") => ({ object: "page", entry: [{ id: page, time: 1, changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, form_id: formId, page_id: page } }] }] });
  const leadReply = (ph: string) => (url: URL) =>
    /^\/v[\d.]+\/lead\d+$/.test(url.pathname) ? new Response(JSON.stringify({ id: url.pathname.split("/").pop(), field_data: [{ name: "full_name", values: ["Rohit Verma"] }, { name: "phone_number", values: [`+91${ph}`] }, { name: "email", values: ["rohit@example.com"] }] }), { status: 200 }) : null;

  it("a signed submission is read from Meta, saved and answered; a repeat delivery does nothing", async () => {
    vi.stubEnv("META_APP_SECRET", SECRET);
    const t = await makeTenant();
    const { body } = await connect(t);
    const ph = phone();
    mockGraph(leadReply(ph));
    const lead = `lead${Date.now()}`;
    const res = await json(await metaWebhook.POST(sign(payload(body.pageId as string, lead))));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 1, duplicates: 0 });
    const contact = await db.contact.findFirstOrThrow({ where: { organizationId: t.org.id, phone: `+91${ph}` } });
    expect(contact).toMatchObject({ name: "Rohit Verma", email: "rohit@example.com", source: "meta_lead_ad", optInStatus: "opted_in" });
    expect(await db.lead.findUniqueOrThrow({ where: { leadgenId: lead } })).toMatchObject({ status: "messaged", isTest: false, formId: "777" });
    expect((await db.leadSource.findFirstOrThrow({ where: { organizationId: t.org.id } })).leadsCount).toBe(1);

    const again = await json(await metaWebhook.POST(sign(payload(body.pageId as string, lead))));
    expect(again.body).toEqual({ received: 0, duplicates: 1 });
    expect(await db.message.count({ where: { organizationId: t.org.id, direction: "outbound" } })).toBe(1);
  });

  it("refuses a bad signature, ignores unknown Pages, paused sources and other forms", async () => {
    vi.stubEnv("META_APP_SECRET", SECRET);
    const t = await makeTenant();
    const { body, id } = await connect(t, { formId: "777" });
    mockGraph(leadReply(phone()));
    expect((await metaWebhook.POST(sign(payload(body.pageId as string, `lead${n++}`), "wrong-secret-wrong-secret-wrong-secret"))).status).toBe(401);
    expect((await json(await metaWebhook.POST(sign(payload("99999999999", `lead${n++}`))))).body).toEqual({ received: 0, duplicates: 0 });
    expect((await json(await metaWebhook.POST(sign(payload(body.pageId as string, `lead${n++}`, "888"))))).body).toEqual({ received: 0, duplicates: 0 }); // a different form
    await source.PATCH(req("/x", { method: "PATCH", body: { status: "paused" } }), P(t.org.id, { sid: id }));
    expect((await json(await metaWebhook.POST(sign(payload(body.pageId as string, `lead${n++}`))))).body).toEqual({ received: 0, duplicates: 0 });
    expect(await db.contact.count({ where: { organizationId: t.org.id, source: "meta_lead_ad" } })).toBe(0);
  });

  it("when Meta can't return the lead (expired token) a failed row is kept so it is visible", async () => {
    vi.stubEnv("META_APP_SECRET", SECRET);
    const t = await makeTenant();
    const { body, id } = await connect(t);
    mockGraph((url) => (/\/lead\d+$/.test(url.pathname) ? new Response(JSON.stringify({ error: { message: "Error validating access token: Session has expired" } }), { status: 400 }) : null));
    const lead = `lead${Date.now()}`;
    expect((await metaWebhook.POST(sign(payload(body.pageId as string, lead)))).status).toBe(200);
    const row = await db.lead.findUniqueOrThrow({ where: { leadgenId: lead } });
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/Session has expired/);
    expect(JSON.stringify((await json(await leadsList.GET(req("/x"), P(t.org.id, { sid: id })))).body)).not.toContain("EAAG");
  });
});
