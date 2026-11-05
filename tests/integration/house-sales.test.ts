import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as automations from "@/app/api/organizations/[orgId]/automations/route";
import * as library from "@/app/api/organizations/[orgId]/automations/library/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/automations/[aid]/publish/route";
import { runDueAutomations } from "@/services/automations/engine";
import { receiveInbound } from "@/services/inbox/messaging";
import { houseSalesGraph, plansMessage, type SalesPlan } from "@/lib/house-sales";
import { validateGraph } from "@/lib/automations";

const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });
const ALL = ["campaigns", "automations", "flows", "ai_agent", "api", "webhooks", "analytics"];
const CATALOGUE: SalesPlan[] = [
  { name: "Starter", priceMonthly: 149900, priceYearly: 1499000, trialDays: 7, maxUsers: 3, maxWhatsAppNumbers: 1, maxMonthlyMessages: 2000, features: ["campaigns", "automations", "flows", "analytics"], selfServe: true },
  { name: "Growth", priceMonthly: 349900, priceYearly: 3499000, trialDays: 14, maxUsers: 10, maxWhatsAppNumbers: 2, maxMonthlyMessages: 10000, features: ALL, selfServe: true },
  { name: "Pro", priceMonthly: 749900, priceYearly: 7499000, trialDays: 14, maxUsers: 25, maxWhatsAppNumbers: 5, maxMonthlyMessages: 50000, features: ALL, selfServe: true },
  { name: "Enterprise", priceMonthly: 1999900, priceYearly: 0, trialDays: 0, maxUsers: -1, maxWhatsAppNumbers: -1, maxMonthlyMessages: -1, features: ALL, selfServe: false },
];

let houseOrg = "";
let houseAccount = "";
let otherOrg = "";
let n = 0;
const phone = () => `+9198${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;

async function drain() {
  for (let i = 0; i < 30; i++) {
    const r = await runDueAutomations(20_000);
    if (!r.ran && !r.scheduled) return;
  }
}
const AD = { sourceType: "ad", sourceId: "120210000000001", sourceUrl: "https://fb.me/x", headline: "WhatsApp automation for your business", body: "", ctwaClid: "c1" };
async function say(from: string, body: string, type: "text" | "button" = "text", fromAd = false) {
  const r = await receiveInbound(houseOrg, houseAccount, { externalId: `t.${randomUUID()}`, fromPhone: from, profileName: "lead_99", type, body, at: new Date(), isDemo: true, ...(fromAd ? { referral: AD } : {}) });
  await drain();
  return r!;
}
const sent = async (conversationId: string) => (await db.message.findMany({ where: { conversationId, direction: "outbound" }, orderBy: { createdAt: "asc" } })).map((m) => m.body);

async function workspace(name: string) {
  const org = (await makeOrg(name)).id;
  const [owner, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Sales" })]);
  await addMember(org, owner.id, "CLIENT_OWNER");
  await addMember(org, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
  await db.subscription.create({ data: { organizationId: org, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const d = await json(await demoConnect.POST(post({ businessName: name }), P(org)));
  return { org, account: (d.body.account as { id: string }).id, owner };
}

let houseOwner: Awaited<ReturnType<typeof makeUser>>;
let otherOwner: Awaited<ReturnType<typeof makeUser>>;
beforeAll(async () => {
  const other = await workspace("Some Client");
  otherOrg = other.org;
  otherOwner = other.owner;
  const h = await workspace("MECGURA");
  houseOrg = h.org;
  houseAccount = h.account;
  houseOwner = h.owner;
  await db.siteSetting.upsert({ where: { key: "home:wa_bot" }, create: { key: "home:wa_bot", value: JSON.stringify({ whatsappAccountId: houseAccount }) }, update: { value: JSON.stringify({ whatsappAccountId: houseAccount }) } });
});
afterAll(async () => {
  await db.siteSetting.deleteMany({ where: { key: "home:wa_bot" } });
});

describe("MECGURA sales automation", () => {
  it("quotes the real catalogue in one message and is a valid flow", () => {
    const m = plansMessage(CATALOGUE);
    expect(m.length).toBeLessThanOrEqual(1024);
    expect(m).toContain("*Starter – ₹1,499/month*");
    expect(m).toContain("*Growth – ₹3,499/month* ⭐");
    expect(m).toContain("*Pro – ₹7,499/month*");
    expect(m).toContain("*Enterprise – ₹19,999/month se*");
    expect(m).toContain("Unlimited members");
    expect(m).toContain("2 mahine free");
    expect(m).toContain("7–14 din ka free trial");
    expect(m).toContain("Meta khud bill karta hai");
    const g = houseSalesGraph(CATALOGUE);
    expect(validateGraph(g).errors).toEqual([]);
  });

  it("is only offered to MECGURA's own workspace", async () => {
    actAs(otherOwner);
    const others = await json(await library.GET(req("/x"), P(otherOrg)));
    expect((others.body.templates as { id: string }[]).some((t) => t.id === "mecgura_sales")).toBe(false);
    expect((await automations.POST(post({ name: "Sales", start: "mecgura_sales" }), P(otherOrg))).status).toBe(400);
    actAs(houseOwner);
    const mine = await json(await library.GET(req("/x"), P(houseOrg)));
    expect((mine.body.templates as { id: string; locked: boolean }[])[0]).toMatchObject({ id: "mecgura_sales", locked: false });
  });

  it("price → plan → business → demo call: hot lead assigned with the answers saved", async () => {
    actAs(houseOwner);
    const c = await json(await automations.POST(post({ name: "MECGURA sales", start: "mecgura_sales", whatsappAccountId: houseAccount }), P(houseOrg)));
    expect(c.status).toBe(201);
    const aid = (c.body.automation as { id: string }).id;
    expect((await publishRoute.POST(post({}), P(houseOrg, { aid }))).status).toBe(200);

    const from = phone();
    const first = await say(from, "Hi, I saw your ad", "text", true);
    await say(from, "Price / plans", "button");
    let out = await sent(first.conversationId);
    expect(out.some((b) => b.startsWith("📋 *MECGURA plans*") && b.includes("₹"))).toBe(true);
    await say(from, "Starter / Growth", "button");
    await say(from, "Salon");
    await say(from, "Haan, call karo", "button");
    await say(from, "Rohit Sharma");
    await say(from, "Kal subah", "button");
    out = await sent(first.conversationId);
    expect(out.at(-1)).toContain("✅ Ho gaya! Hamari team (Kal subah)");
    const contact = await db.contact.findUniqueOrThrow({ where: { id: first.contactId }, include: { tags: { include: { tag: true } } } });
    expect(contact).toMatchObject({ name: "Rohit Sharma", leadStatus: "qualified" });
    expect(JSON.parse(contact.customFields)).toMatchObject({ plan_interest: "Starter / Growth", business: "Salon", call_time: "Kal subah" });
    expect(contact.tags.map((t) => t.tag.name)).toContain("Demo booked");
    expect((await db.conversation.findUniqueOrThrow({ where: { id: first.conversationId } })).assignedToUserId).not.toBeNull();

    // "Free demo" goes straight to booking.
    const from2 = phone();
    const second = await say(from2, "Hello", "text", true);
    await say(from2, "Free demo", "button");
    expect((await sent(second.conversationId)).at(-1)).toBe("Badhiya! 🙌 Call kis naam se karein?");

    // Silent after the welcome: tagged, nothing else sent.
    const from3 = phone();
    const third = await say(from3, "Hi", "text", true);
    const before = (await sent(third.conversationId)).length;
    await db.automationExecution.updateMany({ where: { contactId: third.contactId, status: "running" }, data: { nextRunAt: new Date(Date.now() - 1000) } });
    await drain();
    expect((await sent(third.conversationId)).length).toBe(before);
    const quiet = await db.contact.findUniqueOrThrow({ where: { id: third.contactId }, include: { tags: { include: { tag: true } } } });
    expect(quiet.tags.map((t) => t.tag.name)).toContain("No reply");
  });
});
