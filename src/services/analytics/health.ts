import { db } from "@/lib/db";

const DAY = 86_400_000;

export type ClientHealth = {
  id: string;
  name: string;
  walletBalance: number;
  lowWallet: boolean;
  overdueInvoices: number;
  messages7d: number;
  failed7d: number;
  silent: boolean;
  issues: string[];
};

/**
 * Platform-wide watch list for the admin: active workspaces that need attention (wallet empty or low, overdue invoices,
 * many failed sends, or a connected number with no traffic for a week). Quiet healthy workspaces are not listed.
 */
export async function getClientHealth(limit = 10, now = new Date()): Promise<{ checked: number; flagged: ClientHealth[] }> {
  const since = new Date(now.getTime() - 7 * DAY);
  const orgs = await db.organization.findMany({
    where: { status: "active", whatsappAccounts: { some: { status: { in: ["connected", "demo"] } } } },
    select: { id: true, name: true, wallet: { select: { balance: true, lowBalanceThreshold: true } } },
    take: 500,
  });
  const ids = orgs.map((o) => o.id);
  const [sent, failed, overdue, defaultPriced, orgPriced] = await Promise.all([
    db.message.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids }, createdAt: { gte: since }, direction: { in: ["inbound", "outbound"] } }, _count: { _all: true } }),
    db.message.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids }, createdAt: { gte: since }, direction: "outbound", status: "failed" }, _count: { _all: true } }),
    db.invoice.groupBy({ by: ["organizationId"], where: { organizationId: { in: ids }, status: "open", dueAt: { lt: now } }, _count: { _all: true } }),
    db.walletPrice.count({ where: { organizationId: "", pricePaise: { gt: 0 } } }),
    db.walletPrice.findMany({ where: { organizationId: { in: ids }, pricePaise: { gt: 0 } }, select: { organizationId: true } }),
  ]);
  const ownPrice = new Set(orgPriced.map((p) => p.organizationId));
  const by = (rows: { organizationId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.organizationId, r._count._all]));
  const msgs = by(sent);
  const fails = by(failed);
  const over = by(overdue);

  const flagged: ClientHealth[] = [];
  for (const o of orgs) {
    const balance = o.wallet?.balance ?? 0;
    const threshold = o.wallet?.lowBalanceThreshold ?? 0;
    const lowWallet = (defaultPriced > 0 || ownPrice.has(o.id)) && (balance <= 0 || (threshold > 0 && balance <= threshold));
    const messages7d = msgs.get(o.id) ?? 0;
    const failed7d = fails.get(o.id) ?? 0;
    const overdueInvoices = over.get(o.id) ?? 0;
    const silent = messages7d === 0;
    const issues = [
      ...(lowWallet ? [balance <= 0 ? "Wallet is empty" : "Wallet is low"] : []),
      ...(overdueInvoices ? [`${overdueInvoices} overdue invoice${overdueInvoices === 1 ? "" : "s"}`] : []),
      ...(failed7d >= 5 && failed7d * 5 >= messages7d ? [`${failed7d} failed sends this week`] : []),
      ...(silent ? ["No messages for 7 days"] : []),
    ];
    if (issues.length) flagged.push({ id: o.id, name: o.name, walletBalance: balance, lowWallet, overdueInvoices, messages7d, failed7d, silent, issues });
  }
  flagged.sort((a, b) => b.issues.length - a.issues.length || a.name.localeCompare(b.name));
  return { checked: orgs.length, flagged: flagged.slice(0, limit) };
}
