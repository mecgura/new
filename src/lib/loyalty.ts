// Referral & loyalty rules. Pure module (no DB) shared by the service, the UI and tests.
import { z } from "zod";

export const tierSchema = z.object({ name: z.string().trim().min(1).max(30), minPoints: z.coerce.number().int().min(0).max(10_000_000) }).strict();

export const loyaltySettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** Points for every ₹100 spent. */
    pointsPer100: z.coerce.number().min(0).max(1000),
    /** How many rupees one point is worth when shown to customers (for messages only). */
    rupeesPerPoint: z.coerce.number().min(0).max(1000),
    welcomePoints: z.coerce.number().int().min(0).max(100_000),
    referrerPoints: z.coerce.number().int().min(0).max(100_000),
    refereePoints: z.coerce.number().int().min(0).max(100_000),
    /** A referral pays out after the new customer's first purchase of at least this amount. */
    referralMinPurchaseRupees: z.coerce.number().min(0).max(10_000_000),
    /** "auto" pays referral rewards straight away; "manual" waits for an owner or manager. */
    referralApproval: z.enum(["auto", "manual"]),
    /** Points expire this many days after they're earned (0 = never). */
    expiryDays: z.coerce.number().int().min(0).max(3650),
    tiers: z.array(tierSchema).max(6),
  })
  .strict()
  .superRefine((v, ctx) => {
    const mins = v.tiers.map((t) => t.minPoints);
    if (mins.some((m, i) => i > 0 && m <= mins[i - 1])) ctx.addIssue({ code: "custom", message: "Each tier needs more points than the one before.", path: ["tiers"] });
  });
export type LoyaltySettings = z.infer<typeof loyaltySettingsSchema>;

export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: false,
  pointsPer100: 5,
  rupeesPerPoint: 1,
  welcomePoints: 0,
  referrerPoints: 100,
  refereePoints: 50,
  referralMinPurchaseRupees: 500,
  referralApproval: "manual",
  expiryDays: 365,
  tiers: [
    { name: "Silver", minPoints: 0 },
    { name: "Gold", minPoints: 1000 },
    { name: "Platinum", minPoints: 5000 },
  ],
};

export function parseLoyalty(raw: string | null | undefined): LoyaltySettings {
  if (!raw) return DEFAULT_LOYALTY;
  try {
    const p = loyaltySettingsSchema.safeParse({ ...DEFAULT_LOYALTY, ...(JSON.parse(raw) as object) });
    return p.success ? p.data : DEFAULT_LOYALTY;
  } catch {
    return DEFAULT_LOYALTY;
  }
}

export const pointsForPurchase = (amountPaise: number, s: Pick<LoyaltySettings, "pointsPer100">) => Math.floor((amountPaise / 10_000) * s.pointsPer100);

export type LedgerEntry = { points: number; status: string; createdAt: Date; expiresAt: Date | null };

/**
 * Balance with first-in-first-out expiry: redemptions use the oldest points first, and whatever is left of a batch
 * after its expiry date is gone. Only approved entries count; pending referral rewards are shown separately.
 */
export function balanceOf(entries: LedgerEntry[], now = new Date()) {
  const lots: { left: number; expiresAt: Date | null }[] = [];
  let expired = 0;
  let lifetime = 0;
  const sorted = entries.filter((e) => e.status === "approved").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const expireUpTo = (t: Date) => {
    for (const l of lots) {
      if (l.left > 0 && l.expiresAt && l.expiresAt <= t) {
        expired += l.left;
        l.left = 0;
      }
    }
  };
  for (const e of sorted) {
    expireUpTo(e.createdAt);
    if (e.points > 0) {
      lots.push({ left: e.points, expiresAt: e.expiresAt });
      lifetime += e.points;
    } else {
      let need = -e.points;
      for (const l of lots) {
        if (!need) break;
        const take = Math.min(l.left, need);
        l.left -= take;
        need -= take;
      }
    }
  }
  expireUpTo(now);
  const balance = lots.reduce((a, l) => a + l.left, 0);
  const soon = new Date(now.getTime() + 30 * 86_400_000);
  const expiringSoon = lots.filter((l) => l.left > 0 && l.expiresAt && l.expiresAt <= soon).reduce((a, l) => a + l.left, 0);
  return { balance, lifetime, expired, expiringSoon };
}

/** Tier by lifetime points earned (spending points never drops a customer's tier). */
export function tierFor(lifetime: number, tiers: LoyaltySettings["tiers"]) {
  let current: (typeof tiers)[number] | null = null;
  for (const t of tiers) if (lifetime >= t.minPoints) current = t;
  const next = tiers.find((t) => t.minPoints > lifetime) ?? null;
  return { tier: current?.name ?? "", next: next ? { name: next.name, pointsToGo: next.minPoints - lifetime } : null };
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function makeCode(rand: () => number = Math.random) {
  return Array.from({ length: 6 }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join("");
}

/** A referral code inside a customer's first message, e.g. "Hi! Referred by REF-K7M2QX". */
export function codeInText(text: string): string | null {
  const m = text.toUpperCase().match(/\bREF[\s:#-]+([A-HJ-NP-Z2-9]{6})\b/);
  return m ? m[1] : null;
}
