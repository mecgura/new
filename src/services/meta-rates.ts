import { z } from "zod";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * Meta's own per-message WhatsApp charges (India, in paise), used only to show an estimate before sending and to
 * estimate Meta spend. Meta bills the WhatsApp Business account directly; these numbers never move money in MECGURA.
 * Meta changes its rate card from time to time, so the Super Admin keeps them current.
 */
const KEY = "meta_rates";

export const metaRatesSchema = z.object({
  marketing: z.coerce.number().min(0).max(10_000),
  utility: z.coerce.number().min(0).max(10_000),
  authentication: z.coerce.number().min(0).max(10_000),
});
export type MetaRates = z.infer<typeof metaRatesSchema>;

/** India rates per delivered message (paise) as published by Meta for 2025-26. Check Meta's rate card and update in Admin. */
export const DEFAULT_META_RATES: MetaRates = { marketing: 78.46, utility: 11.5, authentication: 11.5 };

export async function getMetaRates(): Promise<MetaRates> {
  try {
    const parsed = metaRatesSchema.safeParse(JSON.parse(await getSetting(KEY, "")));
    return parsed.success ? parsed.data : DEFAULT_META_RATES;
  } catch {
    return DEFAULT_META_RATES;
  }
}

export async function saveMetaRates(r: MetaRates) {
  await setSetting(KEY, JSON.stringify(r));
  return r;
}

/** Meta's charge for one message of a category (paise). Service replies inside the 24-hour window are free. */
export function metaRateFor(rates: MetaRates, category: string): number {
  const c = category.toLowerCase();
  return c === "marketing" || c === "utility" || c === "authentication" ? rates[c] : 0;
}
