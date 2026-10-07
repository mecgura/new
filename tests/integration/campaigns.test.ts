import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";

// Sending is driven explicitly in tests (no background work racing assertions).
vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as manualConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/manual/route";
import * as contactsRoute from "@/app/api/organizations/[orgId]/contacts/route";
import * as contactRoute from "@/app/api/organizations/[orgId]/contacts/[id]/route";
import * as tagsRoute from "@/app/api/organizations/[orgId]/tags/route";
import * as templates from "@/app/api/organizations/[orgId]/templates/route";
import * as template from "@/app/api/organizations/[orgId]/templates/[tid]/route";
import * as submit from "@/app/api/organizations/[orgId]/templates/[tid]/submit/route";
import * as review from "@/app/api/organizations/[orgId]/templates/[tid]/review/route";
import * as duplicate from "@/app/api/organizations/[orgId]/templates/[tid]/duplicate/route";
import * as segments from "@/app/api/organizations/[orgId]/segments/route";
import * as campaigns from "@/app/api/organizations/[orgId]/campaigns/route";
import * as campaign from "@/app/api/organizations/[orgId]/campaigns/[cid]/route";
import * as preview from "@/app/api/organizations/[orgId]/campaigns/audience-preview/route";
import * as campaignReview from "@/app/api/organizations/[orgId]/campaigns/[cid]/review/route";
import * as launch from "@/app/api/organizations/[orgId]/campaigns/[cid]/launch/route";
import * as actions from "@/app/api/organizations/[orgId]/campaigns/[cid]/actions/route";
import * as analytics from "@/app/api/organizations/[orgId]/campaigns/[cid]/analytics/route";
import * as demo from "@/app/api/organizations/[orgId]/campaigns/[cid]/demo/route";
import * as quality from "@/app/api/organizations/[orgId]/quality/route";
import * as cron from "@/app/api/cron/campaigns/route";
import * as metaWebhook from "@/app/api/webhooks/meta/route";
import { processCampaign, runDueCampaigns } from "@/services/campaigns/sender";

type U = Awaited<ReturnType<typeof makeUser>>;
type Tenant = { orgId: string; owner: U; manager: U; agent: U; accountId: string; wabaId: string };
let n = 0;
const phone = () => `+9197${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });
const patch = (body: unknown) => req("/x", { method: "PATCH", body });

async function makeTenant(): Promise<Tenant> {
  const org = await makeOrg(`Camp ${n++}`);
  const [owner, manager, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Manager" }), makeUser({ name: "Agent" })]);
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 20, maxWhatsAppNumbers: 3 });
  await db.plan.update({ where: { id: plan.id }, data: { maxContacts: 10_000 } });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const d = await json(await demoConnect.POST(post({ businessName: "Demo Store" }), P(org.id)));
  const accountId = (d.body.account as { id: string }).id;
  const acct = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } });
  return { orgId: org.id, owner, manager, agent, accountId, wabaId: acct.wabaRecordId! };
}

async function addContact(t: Tenant, body: Record<string, unknown>) {
  const r = await json(await contactsRoute.POST(post({ phone: phone(), ...body }), P(t.orgId)));
  expect(r.status).toBe(201);
  return (r.body.contact as { id: string; phone: string }).id;
}

async function approvedTemplate(t: Tenant, def: Record<string, unknown>) {
  const c = await json(await templates.POST(post({ wabaId: t.wabaId, language: "en", ...def }), P(t.orgId)));
  expect(c.status).toBe(201);
  const tid = (c.body.template as { id: string }).id;
  expect((await submit.POST(post({}), P(t.orgId, { tid }))).status).toBe(200);
  expect((await review.POST(post({ decision: "approved" }), P(t.orgId, { tid }))).status).toBe(200);
  return tid;
}

const MARKETING = {
  name: "diwali_offer",
  category: "MARKETING",
  headerType: "text",
  headerText: "Diwali sale",
  body: "Hi {{1}}, get {{2}} off at our {{3}} store this Diwali. Reply STOP to unsubscribe.",
  examples: { body: ["Priya", "20%", "Pune"] },
  buttons: [{ type: "QUICK_REPLY", text: "Interested" }, { type: "QUICK_REPLY", text: "Stop promotions" }],
};

afterEach(() => vi.restoreAllMocks());

describe("templates", () => {
  let t: Tenant;
  beforeAll(async () => {
    t = await makeTenant();
  });

  it("create → validation → submit → (demo) review → edit rules → duplicate → delete", async () => {
    actAs(t.owner);
    const bad = await json(await templates.POST(post({ wabaId: t.wabaId, name: "Bad Name", language: "en", category: "UTILITY", body: "{{1}} is your order" }), P(t.orgId)));
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.details as object)).toEqual(expect.arrayContaining(["name", "body"]));

    const created = await json(await templates.POST(post({ wabaId: t.wabaId, name: "order_update", language: "en", category: "UTILITY", body: "Your order {{1}} has shipped. Thank you for shopping!" }), P(t.orgId)));
    expect(created.status).toBe(201);
    expect(created.body.template).toMatchObject({ status: "draft", slots: [{ key: "body.1" }] });
    const tid = (created.body.template as { id: string }).id;
    expect((await templates.POST(post({ wabaId: t.wabaId, name: "order_update", language: "en", category: "UTILITY", body: "x y z" }), P(t.orgId))).status).toBe(409);

    // Submitting needs a sample for every variable.
    const missing = await json(await submit.POST(post({}), P(t.orgId, { tid })));
    expect(missing.status).toBe(400);
    expect(missing.body.details).toHaveProperty("examples.body.1");
    expect((await template.PATCH(patch({ name: "order_update", language: "en", category: "UTILITY", body: "Your order {{1}} has shipped. Thank you for shopping!", examples: { body: ["#1234"] } }), P(t.orgId, { tid }))).status).toBe(200);
    const sub = await json(await submit.POST(post({}), P(t.orgId, { tid })));
    expect(sub.body.template).toMatchObject({ status: "pending", metaTemplateId: expect.stringMatching(/^DEMO-TPL-/) });
    expect((await submit.POST(post({}), P(t.orgId, { tid }))).status).toBe(409);
    expect((await template.PATCH(patch({ name: "order_update", language: "en", category: "UTILITY", body: "Changed {{1}} text here" }), P(t.orgId, { tid }))).status).toBe(409);

    // Reject → edit → resubmit → approve.
    const rej = await json(await review.POST(post({ decision: "rejected", reason: "Promotional content in utility" }), P(t.orgId, { tid })));
    expect(rej.body.template).toMatchObject({ status: "rejected", rejectedReason: "Promotional content in utility" });
    expect((await template.PATCH(patch({ name: "order_update", language: "en", category: "UTILITY", body: "Your order {{1}} is on its way. Thanks!", examples: { body: ["#1234"] } }), P(t.orgId, { tid }))).status).toBe(200);
    await submit.POST(post({}), P(t.orgId, { tid }));
    const ok = await json(await review.POST(post({ decision: "approved" }), P(t.orgId, { tid })));
    expect(ok.body.template).toMatchObject({ status: "approved", rejectedReason: "" });

    const list = await json(await templates.GET(req("/x?status=approved"), P(t.orgId)));
    expect((list.body.templates as { id: string }[]).map((x) => x.id)).toContain(tid);
    expect((list.body.counts as Record<string, number>).approved).toBeGreaterThanOrEqual(1);

    const dup = await json(await duplicate.POST(post({ name: "order_update_v2" }), P(t.orgId, { tid })));
    expect(dup.body.template).toMatchObject({ status: "draft", body: "Your order {{1}} is on its way. Thanks!" });
    expect((await template.DELETE(req("/x", { method: "DELETE" }), P(t.orgId, { tid: (dup.body.template as { id: string }).id }))).status).toBe(200);

    // Audit trail of the review lifecycle.
    const actionsLogged = (await db.auditLog.findMany({ where: { organizationId: t.orgId, targetId: tid } })).map((a) => a.action);
    expect(actionsLogged).toEqual(expect.arrayContaining(["template.created", "template.submitted", "template.status_changed", "template.updated"]));
  });

  it("authentication templates use Meta's fixed format; agents can read but not manage", async () => {
    actAs(t.owner);
    const auth = await json(await templates.POST(post({ wabaId: t.wabaId, name: "login_code", language: "en", category: "AUTHENTICATION", authOptions: { addSecurityRecommendation: true, codeExpirationMinutes: 5, buttonText: "Copy code" } }), P(t.orgId)));
    expect(auth.status).toBe(201);
    expect(auth.body.template).toMatchObject({ body: "", buttons: [], slots: [{ key: "body.1", label: "Verification code" }] });

    actAs(t.agent);
    expect((await templates.GET(req("/x"), P(t.orgId))).status).toBe(200);
    expect((await templates.POST(post({ wabaId: t.wabaId, name: "agent_tpl", language: "en", category: "UTILITY", body: "Hello there friend" }), P(t.orgId))).status).toBe(403);
  });
});

describe("campaign flow (demo mode)", () => {
  let t: Tenant;
  const c: Record<string, string> = {};
  let tid = "";
  let campaignId = "";

  beforeAll(async () => {
    t = await makeTenant();
    actAs(t.owner);
    c.vip1 = await addContact(t, { name: "Priya Sharma", optInStatus: "opted_in", tags: ["VIP"], customFields: { city: "Pune" }, leadStatus: "qualified" });
    c.vip2 = await addContact(t, { name: "Aman Gill", optInStatus: "opted_in", tags: ["VIP"], customFields: { city: "Delhi" } });
    c.noCity = await addContact(t, { name: "Ravi Kumar", optInStatus: "opted_in", tags: ["VIP"] });
    c.optedOut = await addContact(t, { name: "Old Customer", optInStatus: "opted_out", tags: ["VIP"] });
    c.suppressed = await addContact(t, { name: "Legal Hold", optInStatus: "opted_in", suppressed: true, suppressionReason: "Legal", tags: ["VIP"] });
    c.unknown = await addContact(t, { name: "No Consent", tags: ["VIP"] });
    c.other = await addContact(t, { name: "Not VIP", optInStatus: "opted_in" });
    // A malformed legacy number (e.g. from an old import) must be caught by the review.
    const bad = await db.contact.create({ data: { organizationId: t.orgId, phone: "12345", name: "Broken", optInStatus: "opted_in" } });
    c.bad = bad.id;
    await db.contactTag.create({ data: { contactId: bad.id, tagId: (await db.tag.findFirstOrThrow({ where: { organizationId: t.orgId, name: "VIP" } })).id } });
    tid = await approvedTemplate(t, MARKETING);
  });

  it("1–5: details, audience (tags + consent), template, variables, schedule", async () => {
    actAs(t.manager);
    const created = await json(await campaigns.POST(post({ name: "Diwali VIP", whatsappAccountId: t.accountId }), P(t.orgId)));
    expect(created.status).toBe(201);
    campaignId = (created.body.campaign as { id: string }).id;
    const vip = (await json(await tagsRoute.GET(req("/x"), P(t.orgId)))).body.tags as { id: string; name: string }[];
    const vipId = vip.find((x) => x.name === "VIP")!.id;

    const audience = { mode: "filters", filters: { tagIds: [vipId], consent: [] } };
    const pv = await json(await preview.POST(post({ audience }), P(t.orgId)));
    expect(pv.body).toMatchObject({ total: 7, optedOut: 1, suppressed: 1 });

    // Saved segment with the same filters.
    const seg = await json(await segments.POST(post({ name: "VIP all", filters: { tagIds: [vipId] } }), P(t.orgId)));
    expect(seg.status).toBe(201);
    expect((await segments.POST(post({ name: "VIP all", filters: {} }), P(t.orgId))).status).toBe(409);
    const segs = await json(await segments.GET(req("/x"), P(t.orgId)));
    expect((segs.body.segments as { name: string; contacts: number }[]).find((s) => s.name === "VIP all")?.contacts).toBe(7);

    expect((await campaign.PATCH(patch({ audience: { mode: "segment", segmentId: (seg.body.segment as { id: string }).id }, step: 3 }), P(t.orgId, { cid: campaignId }))).status).toBe(200);

    // Only approved templates can be chosen.
    const draft = await json(await templates.POST(post({ wabaId: t.wabaId, name: "not_approved", language: "en", category: "MARKETING", body: "Hello there friend, new stock is in!" }), P(t.orgId)));
    expect((await campaign.PATCH(patch({ templateId: (draft.body.template as { id: string }).id }), P(t.orgId, { cid: campaignId }))).status).toBe(400);
    expect((await campaign.PATCH(patch({ templateId: tid, step: 4 }), P(t.orgId, { cid: campaignId }))).status).toBe(200);

    const variables = {
      "body.1": { source: "field", field: "first_name", fallback: "there" },
      "body.2": { source: "static", value: "25%" },
      "body.3": { source: "field", field: "custom", key: "city" },
    };
    expect((await campaign.PATCH(patch({ variables, step: 5 }), P(t.orgId, { cid: campaignId }))).status).toBe(200);
    expect((await campaign.PATCH(patch({ scheduledAt: new Date(Date.now() + 30_000).toISOString() }), P(t.orgId, { cid: campaignId }))).status).toBe(400);
    const saved = await json(await campaign.PATCH(patch({ scheduledAt: null, step: 6 }), P(t.orgId, { cid: campaignId })));
    expect(saved.body.campaign).toMatchObject({ step: 6, template: { id: tid }, segment: { name: "VIP all" } });
  });

  it("6: compliance review shows total / eligible / removed with reasons", async () => {
    actAs(t.manager);
    // Launch is refused before a review exists.
    expect((await launch.POST(post({ confirmConsent: true }), P(t.orgId, { cid: campaignId }))).status).toBe(409);
    const r = await json(await campaignReview.POST(post({}), P(t.orgId, { cid: campaignId })));
    expect(r.status).toBe(200);
    const rep = r.body.review as { total: number; eligible: number; removed: number; reasons: Record<string, number>; canSend: boolean; checks: { key: string; status: string }[] };
    expect(rep).toMatchObject({ total: 7, eligible: 2, removed: 5, canSend: true });
    expect(rep.reasons).toEqual({ invalid_phone: 1, opted_out: 1, suppressed: 1, no_consent: 1, missing_variable: 1 });
    expect(rep.checks.map((x) => x.key)).toEqual(expect.arrayContaining(["template", "consent", "opted_out", "suppression", "duplicates", "invalid", "variables", "frequency", "audience"]));
    expect(rep.checks.every((x) => x.status !== "fail")).toBe(true);
  });

  it("7: send requires consent confirmation, freezes recipients and sends through the demo transport", async () => {
    actAs(t.manager);
    expect((await launch.POST(post({}), P(t.orgId, { cid: campaignId }))).status).toBe(400);
    const l = await json(await launch.POST(post({ confirmConsent: true }), P(t.orgId, { cid: campaignId })));
    expect(l.status).toBe(200);
    expect(l.body.campaign).toMatchObject({ status: "sending", totalRecipients: 2 });
    expect((await launch.POST(post({ confirmConsent: true }), P(t.orgId, { cid: campaignId }))).status).toBe(409);
    expect((await campaign.PATCH(patch({ name: "Renamed" }), P(t.orgId, { cid: campaignId }))).status).toBe(409);

    const run = await processCampaign(campaignId);
    expect(run).toMatchObject({ sent: 2, failed: 0, done: true });
    const done = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(done.status).toBe("completed");

    // Each message lands in the customer's inbox thread with the rendered template text.
    const msgs = await db.message.findMany({ where: { organizationId: t.orgId, type: "template", campaignRecipient: { campaignId } }, include: { conversation: true } });
    expect(msgs).toHaveLength(2);
    const priya = msgs.find((m) => m.conversation.contactId === c.vip1)!;
    expect(priya.body).toBe("Diwali sale\n\nHi Priya, get 25% off at our Pune store this Diwali. Reply STOP to unsubscribe.");
    expect(priya).toMatchObject({ status: "sent", isDemo: true, direction: "outbound" });
    expect(JSON.parse(priya.payload)).toMatchObject({ campaignId, templateName: "diwali_offer" });
  });

  it("analytics: delivered, read, failed, replies and opt-outs via simulated webhooks; opt-out is honoured", async () => {
    actAs(t.manager);
    const sim = await json(await demo.POST(post({ delivered: 2, read: 1, replies: 1, optOuts: 1 }), P(t.orgId, { cid: campaignId })));
    expect(sim.status).toBe(200);
    expect(sim.body.applied).toEqual({ failed: 0, delivered: 2, read: 1, replies: 1, optOuts: 1 });

    const a = await json(await analytics.GET(req("/x"), P(t.orgId, { cid: campaignId })));
    expect(a.body.stats).toMatchObject({ total: 2, sent: 2, delivered: 2, read: 1, failed: 0, replies: 1, optOuts: 1 });
    expect(a.body.rates).toMatchObject({ delivered: 100, read: 50, optOuts: 50 });
    expect((a.body.signals as { title: string }[]).map((s) => s.title)).toContain("Demo campaign");
    const replied = await json(await analytics.GET(req("/x?status=replied"), P(t.orgId, { cid: campaignId })));
    expect(replied.body.recipientTotal).toBe(1);

    // STOP → contact opted out with a consent history entry.
    const out = await db.campaignRecipient.findFirstOrThrow({ where: { campaignId, optedOutAt: { not: null } }, include: { contact: { include: { consents: { orderBy: { createdAt: "desc" } } } } } });
    expect(out.contact!.optInStatus).toBe("opted_out");
    expect(out.contact!.consents[0]).toMatchObject({ status: "opted_out", source: "inbound_keyword" });

    // Future marketing campaigns exclude them (and the 24 h marketing frequency cap applies to the other).
    const next = await json(await campaigns.POST(post({ name: "Follow-up", whatsappAccountId: t.accountId }), P(t.orgId)));
    const nid = (next.body.campaign as { id: string }).id;
    await campaign.PATCH(patch({ audience: { mode: "contacts", contactIds: [c.vip1, c.vip2, c.vip1] }, templateId: tid, variables: { "body.1": { source: "static", value: "friend" }, "body.2": { source: "static", value: "10%" }, "body.3": { source: "static", value: "city" } } }), P(t.orgId, { cid: nid }));
    const rr = await json(await campaignReview.POST(post({}), P(t.orgId, { cid: nid })));
    const rep = rr.body.review as { eligible: number; reasons: Record<string, number>; canSend: boolean };
    expect(rep.reasons).toMatchObject({ opted_out: 1, frequency_cap: 1, duplicate: 1 });
    expect(rep.eligible).toBe(0);
    expect(rep.canSend).toBe(false);
    expect((await launch.POST(post({ confirmConsent: true }), P(t.orgId, { cid: nid }))).status).toBe(409);
  });

  it("scheduled campaigns run from the scheduler; consent is re-checked at send time", async () => {
    actAs(t.owner);
    const util = await approvedTemplate(t, { name: "store_hours", category: "UTILITY", body: "Hello {{1}}, our store hours change from Monday. See you soon!", examples: { body: ["Priya"] } });
    const a = await addContact(t, { name: "Sched One", optInStatus: "opted_in" });
    const b = await addContact(t, { name: "Sched Two", optInStatus: "opted_in" });
    const s = await json(await campaigns.POST(post({ name: "Hours notice", whatsappAccountId: t.accountId }), P(t.orgId)));
    const sid = (s.body.campaign as { id: string }).id;
    await campaign.PATCH(patch({ audience: { mode: "contacts", contactIds: [a, b] }, templateId: util, variables: { "body.1": { source: "field", field: "first_name", fallback: "there" } }, scheduledAt: new Date(Date.now() + 10 * 60_000).toISOString() }), P(t.orgId, { cid: sid }));
    await campaignReview.POST(post({}), P(t.orgId, { cid: sid }));
    const l = await json(await launch.POST(post({ confirmConsent: true }), P(t.orgId, { cid: sid })));
    expect(l.body.campaign).toMatchObject({ status: "scheduled", totalRecipients: 2 });

    // Not due yet → nothing happens.
    await runDueCampaigns(5_000);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: sid } })).status).toBe("scheduled");

    // Contact opts out after scheduling; then the time arrives.
    await contactRoute.PATCH(patch({ optInStatus: "opted_out" }), P(t.orgId, { id: b }));
    await db.campaign.update({ where: { id: sid }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await runDueCampaigns(10_000);
    const recips = await db.campaignRecipient.findMany({ where: { campaignId: sid } });
    expect(recips.find((r) => r.contactId === a)?.status).toBe("sent");
    expect(recips.find((r) => r.contactId === b)).toMatchObject({ status: "skipped", error: "Opted out before sending." });
    expect((await db.campaign.findUniqueOrThrow({ where: { id: sid } })).status).toBe("completed");
  });

  it("pause / resume / cancel, and auto-pause when the template stops being approved", async () => {
    actAs(t.owner);
    const util = await approvedTemplate(t, { name: "service_update", category: "UTILITY", body: "Hello, our service update is live now. Thank you!" });
    const ids = await Promise.all([1, 2, 3].map((i) => addContact(t, { name: `Bulk ${i}`, optInStatus: "opted_in" })));
    const mk = async (name: string) => {
      const r = await json(await campaigns.POST(post({ name, whatsappAccountId: t.accountId }), P(t.orgId)));
      const id = (r.body.campaign as { id: string }).id;
      await campaign.PATCH(patch({ audience: { mode: "contacts", contactIds: ids }, templateId: util }), P(t.orgId, { cid: id }));
      await campaignReview.POST(post({}), P(t.orgId, { cid: id }));
      expect((await launch.POST(post({ confirmConsent: true }), P(t.orgId, { cid: id }))).status).toBe(200);
      return id;
    };
    const p = await mk("Pausable");
    expect((await json(await actions.POST(post({ action: "pause" }), P(t.orgId, { cid: p })))).body.campaign).toMatchObject({ status: "paused" });
    expect(await processCampaign(p)).toMatchObject({ sent: 0 });
    expect((await json(await actions.POST(post({ action: "resume" }), P(t.orgId, { cid: p })))).body.campaign).toMatchObject({ status: "sending" });
    expect(await processCampaign(p)).toMatchObject({ sent: 3, done: true });

    const x = await mk("Cancelled");
    expect((await json(await actions.POST(post({ action: "cancel" }), P(t.orgId, { cid: x })))).body.campaign).toMatchObject({ status: "cancelled" });
    expect(await db.campaignRecipient.count({ where: { campaignId: x, status: "skipped", error: "Campaign cancelled." } })).toBe(3);
    expect((await actions.POST(post({ action: "resume" }), P(t.orgId, { cid: x }))).status).toBe(409);

    const y = await mk("Template paused");
    await db.messageTemplate.update({ where: { id: util }, data: { status: "paused" } });
    await processCampaign(y);
    expect(await db.campaign.findUniqueOrThrow({ where: { id: y } })).toMatchObject({ status: "paused", statusReason: expect.stringContaining("paused") });
    expect((await actions.POST(post({ action: "resume" }), P(t.orgId, { cid: y }))).status).toBe(409);
    expect((await db.auditLog.findMany({ where: { organizationId: t.orgId, targetId: y } })).map((l) => l.action)).toEqual(expect.arrayContaining(["campaign.started", "campaign.paused"]));
  });

  it("permissions: agents can view campaigns but not build or send them", async () => {
    actAs(t.agent);
    expect((await campaigns.GET(req("/x"), P(t.orgId))).status).toBe(200);
    expect((await campaigns.POST(post({ name: "Agent", whatsappAccountId: t.accountId }), P(t.orgId))).status).toBe(403);
    expect((await launch.POST(post({ confirmConsent: true }), P(t.orgId, { cid: campaignId }))).status).toBe(403);
    expect((await quality.GET(req("/x"), P(t.orgId))).status).toBe(403);
  });

  it("Quality Center reports coverage, rates, templates, alerts and audit logs", async () => {
    actAs(t.owner);
    const q = await json(await quality.GET(req("/x"), P(t.orgId)));
    expect(q.status).toBe(200);
    const body = q.body as { consent: { total: number; coverage: number }; rates: { optOutRate: number }; templates: { counts: Record<string, number>; attention: { name: string }[] }; alerts: { title: string }[]; logs: { action: string }[]; numbers: { isDemo: boolean }[] };
    expect(body.consent.total).toBeGreaterThan(5);
    expect(body.consent.coverage).toBeGreaterThan(0);
    expect(body.rates.optOutRate).toBeGreaterThan(0);
    expect(body.templates.attention.map((x) => x.name)).toContain("service_update");
    expect(body.alerts.some((a) => a.title.includes("service_update"))).toBe(true);
    expect(body.logs.map((l) => l.action)).toEqual(expect.arrayContaining(["campaign.completed", "template.status_changed", "contact.consent_changed"]));
    expect(body.numbers[0].isDemo).toBe(true);
  });

  it("tenant isolation: another workspace can't see or use this workspace's campaigns, templates or segments", async () => {
    const other = await makeTenant();
    actAs(other.owner);
    expect((await campaigns.GET(req("/x"), P(t.orgId))).status).toBe(403);
    expect((await campaign.GET(req("/x"), P(other.orgId, { cid: campaignId }))).status).toBe(404);
    expect((await analytics.GET(req("/x"), P(other.orgId, { cid: campaignId }))).status).toBe(404);
    expect((await template.GET(req("/x"), P(other.orgId, { tid }))).status).toBe(404);
    expect((await templates.POST(post({ wabaId: t.wabaId, name: "steal", language: "en", category: "UTILITY", body: "Hello there friend" }), P(other.orgId))).status).toBe(400);

    const mine = await json(await campaigns.POST(post({ name: "Mine", whatsappAccountId: other.accountId }), P(other.orgId)));
    const mid = (mine.body.campaign as { id: string }).id;
    expect((await campaigns.POST(post({ name: "Foreign number", whatsappAccountId: t.accountId }), P(other.orgId))).status).toBe(400);
    expect((await campaign.PATCH(patch({ templateId: tid }), P(other.orgId, { cid: mid }))).status).toBe(400);
    const seg = await db.segment.findFirstOrThrow({ where: { organizationId: t.orgId } });
    expect((await campaign.PATCH(patch({ audience: { mode: "segment", segmentId: seg.id } }), P(other.orgId, { cid: mid }))).status).toBe(400);
    const tag = await db.tag.findFirstOrThrow({ where: { organizationId: t.orgId } });
    expect((await campaign.PATCH(patch({ audience: { mode: "filters", filters: { tagIds: [tag.id] } } }), P(other.orgId, { cid: mid }))).status).toBe(400);
    // Foreign contact ids never resolve.
    await campaign.PATCH(patch({ audience: { mode: "contacts", contactIds: [c.vip1, c.vip2] } }), P(other.orgId, { cid: mid }));
    const pv = await json(await preview.POST(post({ audience: { mode: "contacts", contactIds: [c.vip1, c.vip2] } }), P(other.orgId)));
    expect(pv.body).toMatchObject({ total: 0 });
    expect((await demo.POST(post({ delivered: 1 }), P(other.orgId, { cid: campaignId }))).status).toBe(404);
  });
});

describe("cron route", () => {
  it("is disabled without CRON_SECRET and requires the bearer secret", async () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    expect((await cron.GET(new Request("http://localhost/api/cron/campaigns"))).status).toBe(503);
    process.env.CRON_SECRET = "s3cret-for-tests";
    expect((await cron.GET(new Request("http://localhost/api/cron/campaigns", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    expect((await cron.GET(new Request("http://localhost/api/cron/campaigns", { headers: { authorization: "Bearer s3cret-for-tests" } }))).status).toBe(200);
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });
});

describe("live WhatsApp account (Meta mocked)", () => {
  it("submits templates to Meta, applies review webhooks, and sends campaign templates through the Cloud API", async () => {
    const t = await makeTenant();
    actAs(t.owner);
    const ids = { wabaId: `5${Date.now()}${n++}`, phoneNumberId: `6${Date.now()}${n++}` };
    const token = `EAAG${randomBytes(40).toString("hex")}`;
    const secret = randomBytes(16).toString("hex");
    const calls: { path: string; method: string; body: string }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      const path = url.pathname.replace(/^\/v[\d.]+\//, "");
      calls.push({ path, method, body: typeof init?.body === "string" ? init.body : "" });
      const reply = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
      if (path === `${ids.wabaId}/message_templates` && method === "POST") return reply({ id: "778899", status: "PENDING", category: "MARKETING" });
      if (path === `${ids.phoneNumberId}/messages`) return reply({ messages: [{ id: `wamid.C${n++}` }] });
      if (path === `${ids.wabaId}/subscribed_apps`) return reply({ success: true });
      if (path === `${ids.wabaId}/phone_numbers`) return reply({ data: [{ id: ids.phoneNumberId }] });
      if (path === ids.wabaId) return reply({ id: ids.wabaId, name: "Live Biz" });
      if (path === ids.phoneNumberId) return reply({ id: ids.phoneNumberId, display_phone_number: `+91 9${String(Date.now()).slice(-9)}`, verified_name: "Live Biz", quality_rating: "GREEN", messaging_limit_tier: "TIER_1K" });
      return reply({ error: { message: "unknown" } }, 404);
    });
    expect((await manualConnect.POST(post({ wabaId: ids.wabaId, phoneNumberId: ids.phoneNumberId, accessToken: token, appSecret: secret }), P(t.orgId))).status).toBe(201);
    const live = await db.whatsAppAccount.findFirstOrThrow({ where: { organizationId: t.orgId, isDemo: false } });

    const created = await json(await templates.POST(post({ wabaId: live.wabaRecordId, language: "en", ...MARKETING, name: "live_offer" }), P(t.orgId)));
    expect(created.status).toBe(201);
    const tid = (created.body.template as { id: string }).id;
    const sub = await json(await submit.POST(post({}), P(t.orgId, { tid })));
    expect(sub.body.template).toMatchObject({ status: "pending", metaTemplateId: "778899" });
    const sent = JSON.parse(calls.find((x) => x.path === `${ids.wabaId}/message_templates`)!.body);
    expect(sent).toMatchObject({ name: "live_offer", language: "en", category: "MARKETING", components: expect.arrayContaining([{ type: "BODY", text: MARKETING.body, example: { body_text: [["Priya", "20%", "Pune"]] } }]) });
    // Demo-only review is refused for live templates.
    expect((await review.POST(post({ decision: "approved" }), P(t.orgId, { tid }))).status).toBe(403);

    const hook = async (field: string, value: Record<string, unknown>) => {
      const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: ids.wabaId, changes: [{ field, value }] }] });
      const sig = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
      return metaWebhook.POST(new Request("http://localhost:3000/api/webhooks/meta", { method: "POST", headers: { "x-hub-signature-256": sig }, body: raw }));
    };
    expect((await hook("message_template_status_update", { event: "APPROVED", message_template_id: 778899, message_template_name: "live_offer", message_template_language: "en", reason: "NONE" })).status).toBe(200);
    expect(await db.messageTemplate.findUniqueOrThrow({ where: { id: tid } })).toMatchObject({ status: "approved", metaStatus: "APPROVED" });

    const contact = await addContact(t, { name: "Live Customer", optInStatus: "opted_in", customFields: { city: "Amritsar" } });
    const cr = await json(await campaigns.POST(post({ name: "Live", whatsappAccountId: live.id }), P(t.orgId)));
    const cid = (cr.body.campaign as { id: string }).id;
    await campaign.PATCH(patch({ audience: { mode: "contacts", contactIds: [contact] }, templateId: tid, variables: { "body.1": { source: "field", field: "first_name", fallback: "there" }, "body.2": { source: "static", value: "30%" }, "body.3": { source: "field", field: "custom", key: "city" } } }), P(t.orgId, { cid }));
    const rv = await json(await campaignReview.POST(post({}), P(t.orgId, { cid })));
    expect((rv.body.review as { checks: { key: string; status: string }[] }).checks.find((x) => x.key === "plan")?.status).toBe("pass");
    await launch.POST(post({ confirmConsent: true }), P(t.orgId, { cid }));
    expect(await processCampaign(cid)).toMatchObject({ sent: 1, done: true });
    const send = JSON.parse(calls.filter((x) => x.path === `${ids.phoneNumberId}/messages`).at(-1)!.body);
    expect(send).toMatchObject({
      type: "template",
      template: {
        name: "live_offer",
        language: { code: "en" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Live" }, { type: "text", text: "30%" }, { type: "text", text: "Amritsar" }] }],
      },
    });

    // Quality webhook pauses the template → Quality Center raises an alert.
    await hook("message_template_status_update", { event: "PAUSED", message_template_id: 778899, message_template_name: "live_offer", message_template_language: "en", reason: "Low quality" });
    await hook("phone_number_quality_update", { display_phone_number: live.phoneNumber, event: "FLAGGED", current_limit: "TIER_1K" });
    const q = await json(await quality.GET(req("/x"), P(t.orgId)));
    const titles = (q.body.alerts as { title: string }[]).map((a) => a.title);
    expect(titles.some((x) => x.includes("live_offer"))).toBe(true);
    expect(titles.some((x) => x.includes("low quality"))).toBe(true);
  });
});
