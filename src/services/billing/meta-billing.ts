import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getMetaRates, metaRateFor, type MetaRates } from "@/services/meta-rates";
import { setPrices, type FeeCategory } from "@/services/wallet-pricing";

/**
 * Who pays Meta for a client's WhatsApp messages.
 * - client_pays: the client's own card is on their WhatsApp Business account; Meta bills them. The wallet only holds
 *   MECGURA's own service fees (if any).
 * - package: MECGURA's card is on the client's account and the plan includes a monthly number of marketing and utility
 *   messages (plus top-ups). No per-message wallet charge; sending stops when the allowance is used.
 * - prepaid_wallet: MECGURA's card is on the client's account. The client recharges the MECGURA wallet and each
 *   template message is charged at Meta's rate plus a markup, so MECGURA recovers what Meta bills it.
 */
export const META_BILLING_MODES = ["client_pays", "prepaid_wallet", "package"] as const;
export type MetaBillingMode = (typeof META_BILLING_MODES)[number];

export const metaBillingSchema = z.object({
  mode: z.enum(META_BILLING_MODES),
  /** Markup per message in rupees (e.g. 0.20). */
  markupRupees: z.coerce.number().min(0).max(100).optional(),
});

const META_CATEGORIES = ["marketing", "utility", "authentication"] as const satisfies readonly FeeCategory[];

export type MetaBilling = { mode: MetaBillingMode; markupPaise: number };

export async function getMetaBilling(organizationId: string): Promise<MetaBilling> {
  const s = await db.organizationSettings.findUnique({ where: { organizationId }, select: { metaBillingMode: true, prepaidMarkupPaise: true } });
  const mode = (META_BILLING_MODES as readonly string[]).includes(s?.metaBillingMode ?? "") ? (s!.metaBillingMode as MetaBillingMode) : "client_pays";
  return { mode, markupPaise: s?.prepaidMarkupPaise ?? 20 };
}

/** Wallet price per category (paise) for a prepaid client: Meta's rate plus the markup, rounded to whole paise. */
export function prepaidPrices(rates: MetaRates, markupPaise: number): Record<(typeof META_CATEGORIES)[number], number> {
  return Object.fromEntries(META_CATEGORIES.map((c) => [c, Math.round(metaRateFor(rates, c) + markupPaise)])) as Record<(typeof META_CATEGORIES)[number], number>;
}

export async function setMetaBilling(organizationId: string, input: z.infer<typeof metaBillingSchema>, actorUserId: string, req?: Request) {
  if (!(await db.organization.count({ where: { id: organizationId } }))) throw new ApiError("NOT_FOUND", "Client not found.");
  const current = await getMetaBilling(organizationId);
  const markupPaise = input.markupRupees === undefined ? current.markupPaise : Math.round(input.markupRupees * 100);
  await db.organizationSettings.upsert({
    where: { organizationId },
    update: { metaBillingMode: input.mode, prepaidMarkupPaise: markupPaise },
    create: { organizationId, metaBillingMode: input.mode, prepaidMarkupPaise: markupPaise },
  });
  if (input.mode === "prepaid_wallet") await setPrices(organizationId, prepaidPrices(await getMetaRates(), markupPaise), actorUserId, req);
  else if (current.mode === "prepaid_wallet") await setPrices(organizationId, { marketing: null, utility: null, authentication: null }, actorUserId, req);
  await audit({ action: "wallet.settings_updated", actorUserId, organizationId, targetType: "meta_billing", metadata: { mode: input.mode, markupPaise }, req });
  return { mode: input.mode, markupPaise };
}

/** After Meta's rates change, re-prices every prepaid client so their wallet keeps covering Meta's bill. */
export async function syncPrepaidPrices(actorUserId: string, req?: Request) {
  const rates = await getMetaRates();
  const rows = await db.organizationSettings.findMany({ where: { metaBillingMode: "prepaid_wallet" }, select: { organizationId: true, prepaidMarkupPaise: true } });
  for (const r of rows) await setPrices(r.organizationId, prepaidPrices(rates, r.prepaidMarkupPaise), actorUserId, req);
  return rows.length;
}
