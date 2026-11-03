import { z } from "zod";
import { db } from "@/lib/db";
import { sourceOf } from "@/lib/traffic-source";

/**
 * Anonymous website analytics for MECGURA's own site: page views and clicks on the important buttons, with where
 * the visitor came from (utm_source or the referring site) and a client's referral code (?ref=). No IP address,
 * name or number is stored; the visitor id is a random value kept in their browser.
 */
export const trackSchema = z
  .object({
    kind: z.enum(["visit", "click"]),
    name: z.string().trim().max(40).regex(/^[a-z0-9_]*$/).default(""),
    path: z.string().trim().max(200).default("/"),
    referrer: z.string().trim().max(500).default(""),
    utmSource: z.string().trim().max(60).default(""),
    utmCampaign: z.string().trim().max(80).default(""),
    ref: z.string().trim().max(60).regex(/^[a-z0-9-]*$/i).default(""),
    visitor: z.string().trim().max(64).regex(/^[a-zA-Z0-9_-]*$/).default(""),
  })
  .strict();

export async function trackEvent(input: z.infer<typeof trackSchema>, ownHost = "") {
  const path = input.path.startsWith("/") ? input.path.split("?")[0].slice(0, 200) : "/";
  await db.marketingEvent.create({
    data: { kind: input.kind, name: input.name, path, source: sourceOf(input.utmSource, input.referrer, ownHost), campaign: input.utmCampaign, ref: input.ref.toLowerCase(), visitor: input.visitor },
  });
  // Keep six months; trimmed now and then instead of on every write.
  if (Math.random() < 0.01) await db.marketingEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 183 * 86_400_000) } } });
}
