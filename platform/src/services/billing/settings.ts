import { z } from "zod";
import { getSetting, setSetting } from "@/lib/settings";

/** Admin-editable billing policy. Stored as SiteSetting rows, never in code. */
export const billingSettingsSchema = z.object({
  taxPercent: z.coerce.number().min(0).max(100),
  dueDays: z.coerce.number().int().min(0).max(60),
  graceDays: z.coerce.number().int().min(0).max(90),
  companyName: z.string().trim().max(120),
  companyAddress: z.string().trim().max(400),
  taxId: z.string().trim().max(40),
  supportEmail: z.string().trim().max(120),
  footer: z.string().trim().max(300),
  paymentInstructions: z.string().trim().max(600),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;

const KEYS: Record<keyof BillingSettings, [string, string]> = {
  taxPercent: ["billing_tax_percent", "0"],
  dueDays: ["billing_due_days", "7"],
  graceDays: ["billing_grace_days", "7"],
  companyName: ["billing_company_name", "MECGURA"],
  companyAddress: ["billing_company_address", ""],
  taxId: ["billing_tax_id", ""],
  supportEmail: ["billing_support_email", ""],
  footer: ["billing_footer", ""],
  paymentInstructions: ["billing_payment_instructions", ""],
};

export async function getBillingSettings(): Promise<BillingSettings> {
  const entries = await Promise.all((Object.keys(KEYS) as (keyof BillingSettings)[]).map(async (k) => [k, await getSetting(KEYS[k][0], KEYS[k][1])] as const));
  return billingSettingsSchema.parse(Object.fromEntries(entries));
}

export async function saveBillingSettings(input: BillingSettings) {
  for (const k of Object.keys(KEYS) as (keyof BillingSettings)[]) await setSetting(KEYS[k][0], String(input[k]));
}
