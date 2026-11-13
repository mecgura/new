import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as templates from "@/app/api/organizations/[orgId]/templates/route";
import * as submit from "@/app/api/organizations/[orgId]/templates/[tid]/submit/route";
import * as review from "@/app/api/organizations/[orgId]/templates/[tid]/review/route";
import * as dues from "@/app/api/organizations/[orgId]/dues/route";
import * as due from "@/app/api/organizations/[orgId]/dues/[did]/route";
import * as remind from "@/app/api/organizations/[orgId]/dues/remind/route";
import * as sheets from "@/app/api/organizations/[orgId]/integrations/sheets/route";
import * as contactsRoute from "@/app/api/organizations/[orgId]/contacts/route";
import { parseDuesCsv } from "@/services/dues/dues";

afterEach(() => vi.restoreAllMocks());
const post = (body: unknown) => req("/x", { method: "POST", body });
let n = 0;

async function tenant() {
  const org = await makeOrg(`Dues ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const P = params({ orgId: org.id });
  const acc = (await json(await demoConnect.POST(post({ businessName: "Dues" }), P))).body.account as { id: string };
  const acct = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: acc.id } });
  const t = await json(await templates.POST(post({ wabaId: acct.wabaRecordId, name: "bill_reminder", language: "en", category: "UTILITY", body: "Hello {{1}}, this is a reminder that {{2}} for bill {{3}} is due on {{4}}. Please ignore this if you have already paid.", examples: { body: ["Ravi", "₹500", "INV-1", "1 Dec 2026"] } }), P));
  expect(t.status).toBe(201);
  const tid = (t.body.template as { id: string }).id;
  const T = { params: Promise.resolve({ orgId: org.id, tid }) };
  expect((await submit.POST(post({}), T)).status).toBe(200);
  await review.POST(post({ decision: "approved" }), T);
  return { org, owner, agent, P, accountId: acc.id, tid };
}

describe("unpaid bills file", () => {
  it("reads a Tally-style export with loose column names, rupee signs and quoted names", () => {
    const { rows, skipped } = parseDuesCsv('Party Name,Mobile No,Bill No,Pending Amount,Due Date\n"Ravi Traders, Ludhiana",98765 43210,INV-101,"₹12,500.50",15-12-2026\nNo Phone,,INV-2,100,\nZero,9876543211,INV-3,0,\nAman,09876543212,INV-4,Rs. 900 Dr,5-Jan-27');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Ravi Traders, Ludhiana", phone: "+919876543210", invoiceNo: "INV-101", amountPaise: 1_250_050 });
    expect(rows[0].dueDate?.toISOString().slice(0, 10)).toBe("2026-12-15");
    expect(rows[1]).toMatchObject({ phone: "+919876543212", amountPaise: 90_000 });
    expect(rows[1].dueDate?.toISOString().slice(0, 10)).toBe("2027-01-05");
    expect(skipped.map((s) => s.line)).toEqual([3, 4]);
    expect(() => parseDuesCsv("Name,City\nA,B")).toThrow(/Phone/);
  });
});

describe("payment reminders", () => {
  it("uploads bills, reminds once a day, and stops when a bill is paid", async () => {
    const t = await tenant();
    const csv = "Name,Mobile,Bill No,Amount,Due Date\nRavi,9811100001,INV-1,1500,15-12-2026\nSimran,9811100002,INV-2,2500,";
    expect((await json(await dues.POST(post({ csv }), t.P))).status).toBe(400); // consent not confirmed
    actAs(t.agent);
    expect((await json(await dues.POST(post({ csv, consentConfirmed: true }), t.P))).status).toBe(403);
    actAs(t.owner);
    const up = await json(await dues.POST(post({ csv, consentConfirmed: true }), t.P));
    expect(up.body).toMatchObject({ added: 2, updated: 0, skippedCount: 0 });
    // Uploading again updates the same bills instead of doubling them.
    expect((await json(await dues.POST(post({ csv: csv.replace("1500", "1800"), consentConfirmed: true }), t.P))).body).toMatchObject({ added: 0, updated: 2 });

    const r1 = await json(await remind.POST(post({ templateId: t.tid, whatsappAccountId: t.accountId }), t.P));
    expect(r1.body).toMatchObject({ sent: 2, failed: 0 });
    const out = await db.message.findMany({ where: { organizationId: t.org.id, direction: "outbound", type: "template" } });
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.body).join(" ")).toContain("₹1,800");
    // Within 24 hours nobody is reminded again.
    expect((await json(await remind.POST(post({ templateId: t.tid, whatsappAccountId: t.accountId }), t.P))).body).toMatchObject({ sent: 0 });

    const list = await json(await dues.GET(req("/x"), t.P));
    const items = list.body.items as { id: string; status: string; name: string }[];
    expect(items.every((d) => d.status === "sent")).toBe(true);
    expect(list.body.unpaidPaise).toBe(430_000);
    const ravi = items.find((d) => d.name === "Ravi")!;
    await due.PATCH(req("/x", { method: "PATCH", body: { paid: true } }), { params: Promise.resolve({ orgId: t.org.id, did: ravi.id }) });
    await db.dueReminder.updateMany({ where: { organizationId: t.org.id }, data: { lastSentAt: new Date(Date.now() - 2 * 86_400_000) } });
    expect((await json(await remind.POST(post({ templateId: t.tid, whatsappAccountId: t.accountId }), t.P))).body).toMatchObject({ sent: 1 });
    expect((await json(await dues.GET(req("/x"), t.P))).body.paidPaise).toBe(180_000);
  });
});

describe("Google Sheets link", () => {
  it("accepts only an Apps Script URL and adds each new contact as a row", async () => {
    const t = await tenant();
    const put = (url: string) => sheets.PUT(req("/x", { method: "PUT", body: { url } }), t.P);
    expect((await put("https://evil.example.com/hook")).status).toBe(400);
    expect((await put("http://169.254.169.254/latest")).status).toBe(400);
    const url = "https://script.google.com/macros/s/AKfycbx1234567890abcdefghijklmn/exec";
    expect((await put(url)).status).toBe(200);
    const calls: { url: string; body: Record<string, string> }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response("ok", { status: 200 });
    });
    expect((await json(await sheets.POST(post({}), t.P))).body).toEqual({ sent: true });
    const c = await json(await contactsRoute.POST(post({ phone: "+919822200001", name: "Harpreet" }), t.P));
    expect(c.status).toBe(201);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe(url);
    expect(calls[1].body).toMatchObject({ name: "Harpreet", phone: "+919822200001", status: "new" });
    // Removing the link stops the rows.
    expect((await put("")).status).toBe(200);
    await contactsRoute.POST(post({ phone: "+919822200002", name: "Jass" }), t.P);
    expect(calls).toHaveLength(2);
  });
});
