import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeOrg } from "../helpers";
import { getClientHealth } from "@/services/analytics/health";

async function org(name: string, opts: { wallet?: number; overdue?: boolean; traffic?: boolean } = {}) {
  const o = await makeOrg(name);
  const waba = await db.whatsAppBusinessAccount.create({ data: { organizationId: o.id, wabaId: `w${Math.random()}`, name: "W", isDemo: true } });
  const acct = await db.whatsAppAccount.create({ data: { organizationId: o.id, wabaRecordId: waba.id, phoneNumber: `+91${Math.floor(Math.random() * 1e10)}`, displayName: "N", status: "demo", isDemo: true } });
  if (opts.wallet !== undefined) await db.wallet.create({ data: { organizationId: o.id, balance: opts.wallet } });
  if (opts.overdue) await db.invoice.create({ data: { organizationId: o.id, number: `INV-T-${Math.random()}`, status: "open", total: 100, dueAt: new Date(Date.now() - 86_400_000) } });
  if (opts.traffic) {
    const c = await db.contact.create({ data: { organizationId: o.id, phone: `+91${Math.floor(Math.random() * 1e10)}` } });
    const conv = await db.conversation.create({ data: { organizationId: o.id, contactId: c.id, whatsappAccountId: acct.id } });
    await db.message.create({ data: { organizationId: o.id, conversationId: conv.id, direction: "inbound", type: "text", body: "hi" } });
  }
  return o;
}

describe("admin client health", () => {
  it("flags empty wallets, overdue invoices and silent clients, and leaves healthy ones out", async () => {
    const healthy = await org("Healthy Co", { wallet: 500_000, traffic: true });
    const empty = await org("Empty Wallet Co", { wallet: 0, traffic: true });
    await db.walletPrice.create({ data: { organizationId: empty.id, category: "marketing", pricePaise: 50 } });
    const overdue = await org("Overdue Co", { wallet: 500_000, traffic: true, overdue: true });
    const silent = await org("Silent Co", { wallet: 500_000 });
    const r = await getClientHealth(100);
    const by = new Map(r.flagged.map((f) => [f.id, f]));
    expect(by.has(healthy.id)).toBe(false);
    expect(by.get(empty.id)?.issues).toContain("Wallet is empty");
    expect(by.get(overdue.id)?.issues.join()).toMatch(/overdue invoice/);
    expect(by.get(silent.id)?.issues).toContain("No messages for 7 days");
  });
});
