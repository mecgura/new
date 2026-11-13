import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { makeOrg } from "../helpers";
import { reportAdConversion, getConversionSummary, setAdConversions } from "@/services/ads/conversions";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

let n = 0;
async function adCustomer(opts: { daysAgo?: number; connected?: boolean } = {}) {
  const org = await makeOrg(`Conv ${n++}`);
  const waba = await db.whatsAppBusinessAccount.create({ data: { organizationId: org.id, wabaId: `waba_${Date.now()}_${n}` } });
  const conn = await db.whatsAppConnection.create({ data: { organizationId: org.id, method: "manual", status: "active", encryptedAccessToken: opts.connected === false ? "" : encryptSecret("tok") } });
  const acc = await db.whatsAppAccount.create({ data: { organizationId: org.id, displayName: "Main", phoneNumber: `+9198${String(Date.now()).slice(-8)}`, status: "connected", wabaRecordId: waba.id, connectionId: conn.id } });
  const contact = await db.contact.create({ data: { organizationId: org.id, phone: `+9197${String(Date.now()).slice(-8)}`, name: "Buyer" } });
  const conv = await db.conversation.create({ data: { organizationId: org.id, contactId: contact.id, whatsappAccountId: acc.id } });
  const msg = await db.message.create({ data: { organizationId: org.id, conversationId: conv.id, direction: "inbound", type: "text", body: "hi" } });
  await db.adReferral.create({ data: { organizationId: org.id, conversationId: conv.id, contactId: contact.id, messageId: msg.id, sourceType: "ad", sourceId: "123", ctwaClid: "clid-abc", createdAt: new Date(Date.now() - (opts.daysAgo ?? 0) * 86_400_000) } });
  return { org, contact, waba };
}

function mockMeta() {
  const calls: { url: string; body: Record<string, unknown> | null }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(url.endsWith("/dataset") ? { id: "ds_1" } : { events_received: 1 }), { status: 200 });
  });
  return calls;
}

describe("ad conversions reported to Meta", () => {
  it("sends a qualified lead once, creating the dataset the first time", async () => {
    const { org, contact, waba } = await adCustomer();
    const calls = mockMeta();
    expect(await reportAdConversion(org.id, contact.id, "LeadSubmitted")).toBe("sent");
    expect(calls).toHaveLength(2);
    const ev = (calls[1].body!.data as Record<string, unknown>[])[0];
    expect(ev.event_name).toBe("LeadSubmitted");
    expect(ev.action_source).toBe("business_messaging");
    expect((ev.user_data as Record<string, string>).ctwa_clid).toBe("clid-abc");
    expect((await db.whatsAppBusinessAccount.findUnique({ where: { id: waba.id } }))?.capiDatasetId).toBe("ds_1");
    expect(await reportAdConversion(org.id, contact.id, "LeadSubmitted")).toBe("none");
    expect(calls).toHaveLength(2);
  });

  it("sends a sale with the won deal value", async () => {
    const { org, contact } = await adCustomer();
    const stage = await db.pipelineStage.create({ data: { organizationId: org.id, name: "Won", kind: "won", position: 1 } as never });
    await db.deal.create({ data: { organizationId: org.id, contactId: contact.id, stageId: stage.id, title: "Site", valuePaise: 1_500_000, status: "won" } });
    const calls = mockMeta();
    expect(await reportAdConversion(org.id, contact.id, "Purchase")).toBe("sent");
    const ev = (calls[1].body!.data as Record<string, unknown>[])[0];
    expect(ev.custom_data).toEqual({ currency: "INR", value: 15000 });
    const s = await getConversionSummary(org.id, 30);
    expect(s.sales).toBe(1);
    expect(s.salesValuePaise).toBe(1_500_000);
  });

  it("skips old clicks, switched-off workspaces and customers who did not come from an ad", async () => {
    const old = await adCustomer({ daysAgo: 10 });
    const calls = mockMeta();
    expect(await reportAdConversion(old.org.id, old.contact.id, "LeadSubmitted")).toBe("skipped");
    const off = await adCustomer();
    await setAdConversions(off.org.id, false);
    expect(await reportAdConversion(off.org.id, off.contact.id, "LeadSubmitted")).toBe("none");
    const plain = await db.contact.create({ data: { organizationId: off.org.id, phone: "+919000000009", name: "Walk in" } });
    await setAdConversions(off.org.id, true);
    expect(await reportAdConversion(off.org.id, plain.id, "LeadSubmitted")).toBe("none");
    expect(calls).toHaveLength(0);
  });

  it("records Meta's refusal instead of failing the lead update", async () => {
    const { org, contact } = await adCustomer();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "Invalid parameter" } }), { status: 400 }));
    expect(await reportAdConversion(org.id, contact.id, "LeadSubmitted")).toBe("failed");
    const s = await getConversionSummary(org.id, 30);
    expect(s.notSent).toBe(1);
    expect(s.lastProblem).toContain("Invalid parameter");
  });
});
