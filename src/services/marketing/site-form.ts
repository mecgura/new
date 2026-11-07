import { z } from "zod";
import { ApiError } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { recordLead } from "@/services/marketing/leads";

/**
 * The website's lead forms (demo request, template pack, referral). Public, so: a hidden honeypot field, a
 * per-visitor rate limit, and the visitor must tick the consent box. Nothing is sent to them automatically
 * (WhatsApp only allows free text after the customer writes first), so the thank-you step is a button that opens
 * a WhatsApp chat with MECGURA.
 */
const t = (max: number) => z.string().trim().max(max).default("");

export const siteLeadSchema = z
  .object({
    kind: z.enum(["demo", "template_pack", "referral"]).default("demo"),
    name: z.string().trim().min(2, "Enter your name").max(80),
    phone: z.string().trim().min(8, "Enter your mobile number").max(20),
    business: t(120),
    city: t(60),
    need: z.enum(["demo", "pricing", "setup", "ads", "other"]).default("demo"),
    message: t(500),
    /** referral: the business being introduced */
    friendName: t(80),
    friendPhone: t(20),
    page: t(120),
    consent: z.literal(true, { error: "Please tick the box so we can contact you" }),
    /** honeypot: real visitors never see or fill it */
    company: t(200),
    medium: t(60),
    campaign: t(80),
    ref: z.string().trim().max(60).regex(/^[a-z0-9-]*$/i).default(""),
  })
  .strict();
export type SiteLeadInput = z.infer<typeof siteLeadSchema>;

const NEED: Record<SiteLeadInput["need"], string> = { demo: "a free demo", pricing: "pricing", setup: "help with setup", ads: "WhatsApp for ads / leads", other: "something else" };

export async function submitSiteLead(input: SiteLeadInput, ip: string, req?: Request) {
  // A bot that fills the hidden field gets a normal-looking success and nothing is saved.
  if (input.company) return { ok: true as const };
  enforceRateLimit(`site-lead:${ip}`, 5, 10 * 60_000);
  const referral = input.kind === "referral";
  const phone = referral ? input.friendPhone : input.phone;
  if (referral && !input.friendPhone) throw new ApiError("VALIDATION_ERROR", "Enter the business's mobile number.", { details: { friendPhone: ["Enter their mobile number"] } });
  const note = referral
    ? `Referred by ${input.name} (${input.phone}). ${input.message}`.trim()
    : input.kind === "template_pack"
      ? `Downloaded the WhatsApp message template pack.${input.page ? ` Page: ${input.page}.` : ""}`
      : `Wants ${NEED[input.need]}.${input.message ? ` "${input.message}"` : ""}${input.page ? ` Page: ${input.page}.` : ""}`;
  await recordLead(
    {
      name: referral ? input.friendName : input.name,
      phone,
      business: input.business,
      city: input.city,
      source: referral ? "referral" : "website_form",
      note: `${note} (Agreed to be contacted.)`,
      medium: input.medium,
      campaign: input.campaign,
      ref: input.ref,
    },
    null,
    req
  );
  return { ok: true as const };
}
