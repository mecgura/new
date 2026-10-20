import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { getSetting, setSetting } from "@/lib/settings";
import { getMetaRates, type MetaRates } from "@/services/meta-rates";

/**
 * A running estimate of the money left with Meta for each WhatsApp Business account. Meta doesn't share a prepaid
 * balance through its API, so the Super Admin records each top-up made in Meta Business Suite, and MECGURA subtracts
 * what it has sent since (template messages × Meta's rate per category). It's an estimate: Meta's billing page is final.
 */
const KEY = "meta_funds";
const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;

const entrySchema = z.object({
  id: z.string(),
  wabaRecordId: z.string(),
  amountPaise: z.number().int(),
  date: z.string(),
  note: z.string().default(""),
});
const storeSchema = z.object({ entries: z.array(entrySchema).default([]), lowAlertPaise: z.number().int().min(0).default(50_000) });
type Store = z.infer<typeof storeSchema>;

export const addFundsSchema = z
  .object({
    wabaRecordId: z.string().trim().min(1).max(64),
    amount: z.coerce.number().positive().max(10_000_000),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(120).default(""),
  })
  .strict();
export const lowAlertSchema = z.object({ lowAlert: z.coerce.number().min(0).max(1_000_000) }).strict();

async function load(): Promise<Store> {
  try {
    const parsed = storeSchema.safeParse(JSON.parse(await getSetting(KEY, "")));
    return parsed.success ? parsed.data : { entries: [], lowAlertPaise: 50_000 };
  } catch {
    return { entries: [], lowAlertPaise: 50_000 };
  }
}
const save = (s: Store) => setSetting(KEY, JSON.stringify(s));

/** Template messages Meta charges for (sent, delivered or read; not demo) on one WhatsApp Business account since a date. */
async function sentByCategory(wabaRecordId: string, since: Date) {
  const base = { type: "template", direction: "outbound", isDemo: false, status: { in: ["sent", "delivered", "read"] }, createdAt: { gte: since }, conversation: { whatsappAccount: { wabaRecordId } } };
  const counts = await Promise.all(CATEGORIES.map((c) => db.message.count({ where: { ...base, payload: { contains: `"category":"${c}"` } } })));
  return { MARKETING: counts[0], UTILITY: counts[1], AUTHENTICATION: counts[2] };
}

const costOf = (n: Record<(typeof CATEGORIES)[number], number>, r: MetaRates) => Math.round(n.MARKETING * r.marketing + n.UTILITY * r.utility + n.AUTHENTICATION * r.authentication);

export async function metaBalanceOverview(now = new Date()) {
  const [store, rates, wabas] = await Promise.all([
    load(),
    getMetaRates(),
    db.whatsAppBusinessAccount.findMany({ where: { isDemo: false }, select: { id: true, name: true, wabaId: true, organization: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 330 * 60_000); // 1st of the month, IST
  const accounts = await Promise.all(
    wabas.map(async (w) => {
      const entries = store.entries.filter((e) => e.wabaRecordId === w.id).sort((a, b) => a.date.localeCompare(b.date));
      const added = entries.reduce((s, e) => s + e.amountPaise, 0);
      const since = entries[0] ? new Date(`${entries[0].date}T00:00:00+05:30`) : null;
      const [spentSince, month] = await Promise.all([since ? sentByCategory(w.id, since) : null, sentByCategory(w.id, monthStart)]);
      const spent = spentSince ? costOf(spentSince, rates) : 0;
      const remaining = entries.length ? added - spent : null;
      return {
        id: w.id,
        name: w.name || w.wabaId,
        wabaId: w.wabaId,
        organization: w.organization.name,
        added,
        spent,
        remaining,
        low: remaining !== null && remaining < store.lowAlertPaise,
        thisMonth: { messages: month, cost: costOf(month, rates) },
        entries: [...entries].reverse(),
      };
    })
  );
  return { rates, lowAlertPaise: store.lowAlertPaise, accounts };
}

export async function addMetaFunds(input: z.infer<typeof addFundsSchema>) {
  const w = await db.whatsAppBusinessAccount.findUnique({ where: { id: input.wabaRecordId }, select: { id: true } });
  if (!w) throw new ApiError("NOT_FOUND", "WhatsApp Business account not found.");
  const s = await load();
  if (s.entries.length >= 1000) throw new ApiError("CONFLICT", "Too many entries. Remove old ones first.");
  s.entries.push({ id: randomUUID(), wabaRecordId: w.id, amountPaise: Math.round(input.amount * 100), date: input.date, note: input.note });
  await save(s);
}

export async function removeMetaFunds(id: string) {
  const s = await load();
  const next = s.entries.filter((e) => e.id !== id);
  if (next.length === s.entries.length) throw new ApiError("NOT_FOUND", "Entry not found.");
  await save({ ...s, entries: next });
}

export async function setLowAlert(rupees: number) {
  const s = await load();
  await save({ ...s, lowAlertPaise: Math.round(rupees * 100) });
}
