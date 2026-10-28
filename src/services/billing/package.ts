import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { getSetting, setSetting } from "@/lib/settings";
import { formatINR, formatNumber } from "@/lib/catalog";
import { currentPlan, incrementUsage, monthPrefix, monthTotal } from "@/lib/services/usage";
import { getMetaBilling } from "@/services/billing/meta-billing";
import { getMetaRates } from "@/services/meta-rates";
import { debitWallet, getWallet } from "@/services/wallet";
import type { FeeCategory } from "@/services/wallet-pricing";

/**
 * Message packages (billing type "package"): MECGURA pays Meta and the client's plan includes a number of marketing and
 * utility messages each month (authentication counts as utility; replies inside the 24-hour window are free and not
 * counted). Top-up packs, bought from the wallet or added by MECGURA, are used after the monthly allowance and don't
 * expire. Sending stops with a clear message when nothing is left.
 */
export type Bucket = "marketing" | "utility";
export const bucketOf = (category: FeeCategory | string): Bucket | null => (category === "marketing" ? "marketing" : category === "utility" || category === "authentication" ? "utility" : null);
const METRIC: Record<Bucket, "pkg_marketing" | "pkg_utility"> = { marketing: "pkg_marketing", utility: "pkg_utility" };
const LABEL: Record<Bucket, string> = { marketing: "marketing", utility: "utility" };

export type BucketStatus = { included: number; used: number; credits: number; remaining: number; unlimited: boolean };
export type PackageStatus = { active: boolean; planName: string; month: string; resetsOn: string; marketing: BucketStatus; utility: BucketStatus };

const nextMonthStart = (d = new Date()) => {
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
};

export async function packageStatus(organizationId: string): Promise<PackageStatus> {
  const [billing, sub, settings, usedM, usedU] = await Promise.all([
    getMetaBilling(organizationId),
    currentPlan(organizationId),
    db.organizationSettings.findUnique({ where: { organizationId }, select: { creditMarketing: true, creditUtility: true } }),
    monthTotal(organizationId, "pkg_marketing"),
    monthTotal(organizationId, "pkg_utility"),
  ]);
  const bucket = (included: number, used: number, credits: number): BucketStatus => {
    const unlimited = included < 0;
    return { included, used, credits, unlimited, remaining: unlimited ? Infinity : Math.max(0, included - used) + credits };
  };
  return {
    active: billing.mode === "package",
    planName: sub?.plan.name ?? "",
    month: monthPrefix(),
    resetsOn: nextMonthStart(),
    marketing: bucket(sub?.plan.includedMarketing ?? 0, usedM, settings?.creditMarketing ?? 0),
    utility: bucket(sub?.plan.includedUtility ?? 0, usedU, settings?.creditUtility ?? 0),
  };
}

/** Refuses (HTTP 402) when a package client has no messages left for this category. No-op for other billing types. */
export async function assertPackageAllows(organizationId: string, category: FeeCategory | string, count = 1) {
  const b = bucketOf(category);
  if (!b || count <= 0) return;
  const s = await packageStatus(organizationId);
  if (!s.active) return;
  const left = s[b].remaining;
  if (left < count) {
    throw new ApiError(
      "PAYMENT_REQUIRED",
      left === 0
        ? `Your ${LABEL[b]} messages for this month are used up (${formatNumber(s[b].included)} included). Buy a top-up pack in Billing, or they reset on ${s.resetsOn}.`
        : `Only ${formatNumber(left)} ${LABEL[b]} messages are left in your package, ${formatNumber(count)} needed. Buy a top-up pack in Billing.`
    );
  }
}

/** How many messages of this category a package client can still send (Infinity when not on a package). */
export async function packageRemaining(organizationId: string, category: FeeCategory | string) {
  const b = bucketOf(category);
  if (!b) return Infinity;
  const s = await packageStatus(organizationId);
  return s.active ? s[b].remaining : Infinity;
}

/** Counts one sent message against the package; after the monthly allowance it uses a top-up credit. Sends usage alerts. */
export async function consumePackage(organizationId: string, category: FeeCategory | string) {
  const b = bucketOf(category);
  if (!b) return;
  const billing = await getMetaBilling(organizationId);
  if (billing.mode !== "package") return;
  await incrementUsage(organizationId, METRIC[b]);
  const s = await packageStatus(organizationId);
  const bs = s[b];
  if (bs.unlimited) return;
  if (bs.used > bs.included) {
    await db.organizationSettings.updateMany({ where: { organizationId, ...(b === "marketing" ? { creditMarketing: { gt: 0 } } : { creditUtility: { gt: 0 } }) }, data: b === "marketing" ? { creditMarketing: { decrement: 1 } } : { creditUtility: { decrement: 1 } } });
  }
  await usageAlerts(organizationId, b, bs);
}

async function usageAlerts(organizationId: string, b: Bucket, s: BucketStatus) {
  if (s.included <= 0) return;
  const pct = (s.used / s.included) * 100;
  const level = s.used >= s.included && s.credits <= 0 ? 100 : pct >= 80 ? 80 : 0;
  if (!level) return;
  const settings = await db.organizationSettings.findUnique({ where: { organizationId }, select: { packageAlerts: true } });
  let sent: Record<string, boolean> = {};
  try {
    sent = JSON.parse(settings?.packageAlerts ?? "{}");
  } catch {
    sent = {};
  }
  const key = `${monthPrefix()}:${b}:${level}`;
  if (sent[key]) return;
  sent = Object.fromEntries(Object.entries(sent).filter(([k]) => k.startsWith(monthPrefix())));
  sent[key] = true;
  await db.organizationSettings.update({ where: { organizationId }, data: { packageAlerts: JSON.stringify(sent) } });
  const title = level === 100 ? `Your ${LABEL[b]} messages are used up` : `80% of your ${LABEL[b]} messages are used`;
  const body = level === 100 ? "Sending is paused until you buy a top-up pack or the next month starts." : `${formatNumber(s.used)} of ${formatNumber(s.included)} used this month.`;
  const people = await db.organizationMember.findMany({ where: { organizationId, role: { in: ["CLIENT_OWNER", "MANAGER"] } }, select: { userId: true } });
  for (const p of people) await notify({ userId: p.userId, organizationId, type: level === 100 ? "warning" : "info", title, body, link: "/billing?tab=package" });
  const admins = await db.user.findMany({ where: { role: "SUPER_ADMIN", status: "active" }, select: { id: true } });
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  for (const a of admins) await notify({ userId: a.id, organizationId, title: `${org?.name ?? "A client"}: ${title.toLowerCase()}`, body, link: `/admin/clients/${organizationId}?tab=wallet` });
}

// ---------------------------------------------------------------------------
// Top-up packs
// ---------------------------------------------------------------------------
const PACKS_KEY = "package:topups";
export const packSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{1,40}$/),
  bucket: z.enum(["marketing", "utility"]),
  quantity: z.coerce.number().int().min(100).max(1_000_000),
  priceRupees: z.coerce.number().min(1).max(1_000_000),
});
export const packsSchema = z.object({ packs: z.array(packSchema).max(12) });
export type Pack = z.infer<typeof packSchema>;
export const DEFAULT_PACKS: Pack[] = [
  { id: "mkt-1000", bucket: "marketing", quantity: 1000, priceRupees: 1200 },
  { id: "mkt-5000", bucket: "marketing", quantity: 5000, priceRupees: 5500 },
  { id: "utl-5000", bucket: "utility", quantity: 5000, priceRupees: 999 },
];

export async function getPacks(): Promise<Pack[]> {
  try {
    const p = packsSchema.safeParse(JSON.parse(await getSetting(PACKS_KEY, "")));
    return p.success ? p.data.packs : DEFAULT_PACKS;
  } catch {
    return DEFAULT_PACKS;
  }
}

export async function savePacks(packs: Pack[], actorUserId: string, req?: Request) {
  await setSetting(PACKS_KEY, JSON.stringify({ packs }));
  await audit({ action: "wallet.settings_updated", actorUserId, targetType: "package_packs", metadata: { count: packs.length }, req });
  return packs;
}

async function addCredits(organizationId: string, b: Bucket, quantity: number) {
  await db.organizationSettings.upsert({
    where: { organizationId },
    update: b === "marketing" ? { creditMarketing: { increment: quantity } } : { creditUtility: { increment: quantity } },
    create: { organizationId, ...(b === "marketing" ? { creditMarketing: quantity } : { creditUtility: quantity }) },
  });
}

/** The client buys a top-up pack with wallet balance. `key` makes a double click or retry safe. */
export async function buyPack(organizationId: string, packId: string, key: string, actor: { actorUserId: string; req?: Request }) {
  if (!(await packageStatus(organizationId)).active) throw new ApiError("CONFLICT", "Top-up packs are for message package plans.");
  const pack = (await getPacks()).find((p) => p.id === packId);
  if (!pack) throw new ApiError("NOT_FOUND", "That pack is no longer available.");
  const amount = Math.round(pack.priceRupees * 100);
  const idempotencyKey = `pack:${organizationId}:${key}`;
  // A retry of a purchase that already went through returns the current status instead of a low-balance error.
  if (await db.walletEntry.findFirst({ where: { organizationId, idempotencyKey }, select: { id: true } })) return packageStatus(organizationId);
  const { balance } = await getWallet(organizationId);
  if (balance < amount) throw new ApiError("PAYMENT_REQUIRED", `This pack costs ${formatINR(amount)}; your wallet has ${formatINR(balance)}. Add money to the wallet first.`);
  const r = await debitWallet(organizationId, actor, { amount, reason: "usage", note: `Top-up: ${formatNumber(pack.quantity)} ${pack.bucket} messages`, reference: pack.id, idempotencyKey });
  if (!r.replayed) {
    await addCredits(organizationId, pack.bucket, pack.quantity);
    await audit({ action: "wallet.debited", actorUserId: actor.actorUserId, organizationId, targetType: "package_pack", targetId: pack.id, metadata: { quantity: pack.quantity, bucket: pack.bucket, amount }, req: actor.req });
  }
  return packageStatus(organizationId);
}

export const grantSchema = z.object({ marketing: z.coerce.number().int().min(-1_000_000).max(1_000_000).default(0), utility: z.coerce.number().int().min(-1_000_000).max(1_000_000).default(0), note: z.string().trim().max(200).default("") });

/** MECGURA adds (or corrects) top-up credits by hand, e.g. after a cash payment or as a goodwill bonus. */
export async function grantCredits(organizationId: string, input: z.infer<typeof grantSchema>, actorUserId: string, req?: Request) {
  if (!(await db.organization.count({ where: { id: organizationId } }))) throw new ApiError("NOT_FOUND", "Client not found.");
  const s = await db.organizationSettings.findUnique({ where: { organizationId }, select: { creditMarketing: true, creditUtility: true } });
  const nextM = Math.max(0, (s?.creditMarketing ?? 0) + input.marketing);
  const nextU = Math.max(0, (s?.creditUtility ?? 0) + input.utility);
  await db.organizationSettings.upsert({ where: { organizationId }, update: { creditMarketing: nextM, creditUtility: nextU }, create: { organizationId, creditMarketing: nextM, creditUtility: nextU } });
  await audit({ action: "wallet.settings_updated", actorUserId, organizationId, targetType: "package_credits", metadata: { ...input }, req });
  return packageStatus(organizationId);
}

// ---------------------------------------------------------------------------
// Admin: margin per package client this month
// ---------------------------------------------------------------------------
export async function packageMargins() {
  const rows = await db.organizationSettings.findMany({ where: { metaBillingMode: "package" }, select: { organizationId: true, organization: { select: { name: true } } } });
  const rates = await getMetaRates();
  const out = [];
  for (const r of rows) {
    const [s, sub] = await Promise.all([packageStatus(r.organizationId), currentPlan(r.organizationId)]);
    const metaCost = Math.round(s.marketing.used * rates.marketing + s.utility.used * rates.utility);
    const price = sub?.priceMonthly ?? 0;
    out.push({ organizationId: r.organizationId, name: r.organization.name, planName: s.planName, price, metaCost, margin: price - metaCost, marketing: s.marketing, utility: s.utility });
  }
  return out.sort((a, b) => a.margin - b.margin);
}
