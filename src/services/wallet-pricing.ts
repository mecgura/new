import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { formatINR } from "@/lib/catalog";
import { MAX_WALLET_AMOUNT, debitWallet, getWallet } from "@/services/wallet";

/**
 * MECGURA's own per-message service fee, charged from the client's wallet. Meta's charges are separate and are billed
 * by Meta to the client's WhatsApp Business account. A category with no price is free, so nothing is charged (or blocked)
 * until an admin sets a price.
 */
export const FEE_CATEGORIES = ["marketing", "utility", "authentication", "service"] as const;
export type FeeCategory = (typeof FEE_CATEGORIES)[number];
export type PriceMap = Record<FeeCategory, number>;
export type PriceCard = { defaults: PriceMap; overrides: Partial<Record<FeeCategory, number>>; effective: PriceMap };

const GLOBAL = "";
const empty = (): PriceMap => ({ marketing: 0, utility: 0, authentication: 0, service: 0 });
const isCategory = (c: string): c is FeeCategory => (FEE_CATEGORIES as readonly string[]).includes(c);

/** Template messages use their Meta category; everything else sent inside the 24-hour window is a service message. */
export function categoryOfMessage(type: string, payload: unknown): FeeCategory {
  if (type !== "template") return "service";
  try {
    const c = String((typeof payload === "string" ? JSON.parse(payload) : payload)?.category ?? "").toLowerCase();
    return isCategory(c) ? c : "marketing";
  } catch {
    return "marketing";
  }
}

export async function getPriceCard(organizationId: string): Promise<PriceCard> {
  const rows = await db.walletPrice.findMany({ where: { organizationId: { in: [GLOBAL, organizationId] } } });
  const defaults = empty();
  const overrides: PriceCard["overrides"] = {};
  for (const r of rows) {
    if (!isCategory(r.category)) continue;
    if (r.organizationId === GLOBAL) defaults[r.category] = r.pricePaise;
    else overrides[r.category] = r.pricePaise;
  }
  return { defaults, overrides, effective: { ...defaults, ...overrides } };
}

export async function getDefaultPrices(): Promise<PriceMap> {
  const out = empty();
  for (const r of await db.walletPrice.findMany({ where: { organizationId: GLOBAL } })) if (isCategory(r.category)) out[r.category] = r.pricePaise;
  return out;
}

export async function feeFor(organizationId: string, category: FeeCategory): Promise<number> {
  const rows = await db.walletPrice.findMany({ where: { category, organizationId: { in: [GLOBAL, organizationId] } } });
  return (rows.find((r) => r.organizationId === organizationId) ?? rows.find((r) => r.organizationId === GLOBAL))?.pricePaise ?? 0;
}

/**
 * Sets prices (paise) for every client (`organizationId` null) or one client. `null` removes the row: a client row falls
 * back to the default, a default row becomes free.
 */
export async function setPrices(organizationId: string | null, prices: Partial<Record<FeeCategory, number | null>>, actorUserId: string, req?: Request) {
  const scope = organizationId ?? GLOBAL;
  if (organizationId && !(await db.organization.count({ where: { id: organizationId } }))) throw new ApiError("NOT_FOUND", "Client not found.");
  for (const [cat, value] of Object.entries(prices)) {
    if (!isCategory(cat) || value === undefined) continue;
    if (value === null) {
      await db.walletPrice.deleteMany({ where: { organizationId: scope, category: cat } });
      continue;
    }
    if (!Number.isInteger(value) || value < 0 || value > MAX_WALLET_AMOUNT) throw new ApiError("VALIDATION_ERROR", "Enter a valid price.", { details: { [cat]: ["Enter 0 or a positive amount"] } });
    await db.walletPrice.upsert({
      where: { organizationId_category: { organizationId: scope, category: cat } },
      update: { pricePaise: value, updatedById: actorUserId },
      create: { organizationId: scope, category: cat, pricePaise: value, updatedById: actorUserId },
    });
  }
  await audit({ action: "wallet.settings_updated", actorUserId, organizationId, targetType: "wallet_price", metadata: { scope: organizationId ? "client" : "default", prices }, req });
}

const short = (n: number) => `${formatINR(n)}`;

/** Refuses (HTTP 402) when the wallet can't cover `count` messages of this category. Free categories always pass. */
export async function assertCanAfford(organizationId: string, category: FeeCategory, count = 1) {
  const fee = await feeFor(organizationId, category);
  if (fee <= 0 || count <= 0) return;
  const { balance } = await getWallet(organizationId);
  if (balance < fee * count) {
    throw new ApiError("PAYMENT_REQUIRED", `Wallet balance is too low: ${short(fee * count)} needed (${count} × ${short(fee)}), ${short(balance)} available. Ask MECGURA to add credit.`);
  }
}

/** Charges one accepted message, once (idempotent per message). Demo messages and free categories cost nothing. */
export async function chargeMessage(messageId: string): Promise<"charged" | "free" | "unpaid"> {
  const m = await db.message.findUnique({ where: { id: messageId }, select: { organizationId: true, type: true, payload: true, isDemo: true, direction: true } });
  if (!m || m.isDemo || m.direction !== "outbound") return "free";
  const category = categoryOfMessage(m.type, m.payload);
  const fee = await feeFor(m.organizationId, category);
  if (fee <= 0) return "free";
  try {
    await debitWallet(m.organizationId, null, { amount: fee, reason: "usage", reference: messageId, note: `${category} message`, idempotencyKey: `msg:${messageId}` });
    return "charged";
  } catch (e) {
    // The message was already accepted by Meta. If the balance ran out between the check and now, the fee stays unpaid
    // rather than the wallet going negative; the next send is blocked by the balance check.
    if (e instanceof ApiError && e.code === "CONFLICT") {
      console.warn(`[wallet] fee not collected for message ${messageId}: balance too low`);
      return "unpaid";
    }
    throw e;
  }
}
