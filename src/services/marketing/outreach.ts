import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";
import { isEmailConfigured, sendMail } from "@/lib/mailer";
import { fillTemplate } from "@/lib/marketing";
import { normalizePhone } from "@/services/inbox/contacts";
import { recordLead } from "@/services/marketing/leads";

/**
 * Outreach (Super Admin): find local businesses on Google Maps by category and city (official Places API, key in
 * GOOGLE_MAPS_API_KEY), look for a public email on their website, add the ones you like to Leads, then reach out
 * the safe way: one WhatsApp at a time from your own phone with a ready message (daily limit), or a small daily
 * email batch with an unsubscribe link. Search results are not stored (Google's terms); only leads you add are.
 * Bulk WhatsApp to people who never opted in is deliberately not offered: it gets numbers banned.
 */
export const CATEGORIES = [
  "Salon", "Beauty parlour", "Gym", "Yoga studio", "Clinic", "Dentist", "Physiotherapist", "Hospital", "Pharmacy", "Diagnostic lab",
  "Coaching institute", "IELTS centre", "School", "Play school", "Restaurant", "Cafe", "Bakery", "Sweet shop", "Grocery store", "Supermarket",
  "Boutique", "Clothing store", "Jewellery shop", "Electronics store", "Mobile shop", "Furniture store", "Hardware store", "Real estate agent",
  "Builder", "Car dealer", "Car service centre", "Hotel", "Travel agent", "Immigration consultant", "Chartered accountant", "Interior designer",
  "Event planner", "Photographer", "Wedding venue", "Pet shop",
] as const;

export const searchSchema = z
  .object({
    category: z.string().trim().max(60).default(""),
    query: z.string().trim().max(120).default(""),
    city: z.string().trim().min(2, "Enter a city or area").max(80),
    pageToken: z.string().trim().max(1000).default(""),
  })
  .strict()
  .refine((v) => v.category || v.query, { message: "Pick a category or type what to search", path: ["category"] });

export type Prospect = {
  placeId: string;
  name: string;
  phone: string; // E.164 when Google has one
  address: string;
  website: string;
  rating: number | null;
  reviews: number;
  mapsUrl: string;
  category: string;
  open: boolean;
  alreadyLead: boolean;
};

const FIELDS = ["places.id", "places.displayName", "places.formattedAddress", "places.nationalPhoneNumber", "places.internationalPhoneNumber", "places.websiteUri", "places.rating", "places.userRatingCount", "places.googleMapsUri", "places.businessStatus", "places.primaryTypeDisplayName", "nextPageToken"].join(",");

export const placesConfigured = () => Boolean(process.env.GOOGLE_MAPS_API_KEY);

type PlaceRaw = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  businessStatus?: string;
  primaryTypeDisplayName?: { text?: string };
};

/** One page (up to 20) of businesses from Google Maps for "<category> in <city>". */
export async function searchPlaces(input: z.infer<typeof searchSchema>): Promise<{ results: Prospect[]; nextPageToken: string }> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new ApiError("CONFLICT", "Google Maps search isn't set up yet. Add GOOGLE_MAPS_API_KEY in Vercel → Settings → Environment Variables (Places API (New) enabled in Google Cloud), then redeploy.");
  const textQuery = `${input.query || input.category} in ${input.city}`;
  let res: Response;
  try {
    res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
      body: JSON.stringify({ textQuery, languageCode: "en", regionCode: "IN", pageSize: 20, ...(input.pageToken ? { pageToken: input.pageToken } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError("SERVICE_UNAVAILABLE", "Couldn't reach Google Maps. Please try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { places?: PlaceRaw[]; nextPageToken?: string; error?: { message?: string } };
  if (!res.ok) throw new ApiError(res.status === 429 ? "RATE_LIMITED" : "SERVICE_UNAVAILABLE", `Google Maps: ${String(body.error?.message ?? res.status).slice(0, 200)}`);
  const places = body.places ?? [];
  const phones = places.map((p) => normalizePhone(p.internationalPhoneNumber || p.nationalPhoneNumber || "") ?? "").filter(Boolean);
  const known = new Set((await db.marketingLead.findMany({ where: { OR: [{ phone: { in: phones } }, { placeId: { in: places.map((p) => p.id ?? "").filter(Boolean) } }] }, select: { phone: true, placeId: true } })).flatMap((l) => [l.phone, l.placeId]));
  const results = places.map((p): Prospect => {
    const phone = normalizePhone(p.internationalPhoneNumber || p.nationalPhoneNumber || "") ?? "";
    return {
      placeId: p.id ?? "",
      name: p.displayName?.text ?? "",
      phone,
      address: p.formattedAddress ?? "",
      website: p.websiteUri ?? "",
      rating: typeof p.rating === "number" ? p.rating : null,
      reviews: p.userRatingCount ?? 0,
      mapsUrl: p.googleMapsUri ?? "",
      category: p.primaryTypeDisplayName?.text ?? input.category,
      open: !p.businessStatus || p.businessStatus === "OPERATIONAL",
      alreadyLead: Boolean((phone && known.has(phone)) || (p.id && known.has(p.id))),
    };
  });
  return { results, nextPageToken: body.nextPageToken ?? "" };
}

// ---------------------------------------------------------------------------
// Email finder: reads the business's own public website (home page and a contact page)
// ---------------------------------------------------------------------------
const PRIVATE = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1$/, /^f[cd]/i, /^fe80/i];
const isPrivate = (ip: string) => PRIVATE.some((re) => re.test(ip));

/** Only public http(s) sites: never internal addresses (the server must not be tricked into calling them). */
async function safeUrl(raw: string): Promise<URL | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.local$|\.internal$/i.test(host)) return null;
  if (isIP(host)) return isPrivate(host) ? null : u;
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivate(a.address))) return null;
  } catch {
    return null;
  }
  return u;
}

async function fetchPage(url: URL): Promise<string> {
  try {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(6_000), headers: { "user-agent": "Mozilla/5.0 (compatible; MECGURA-outreach/1.0)", accept: "text/html" } });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      const next = loc ? await safeUrl(new URL(loc, url).toString()) : null;
      if (!next) return "";
      const r2 = await fetch(next, { redirect: "manual", signal: AbortSignal.timeout(6_000), headers: { "user-agent": "Mozilla/5.0 (compatible; MECGURA-outreach/1.0)" } });
      return r2.ok ? (await r2.text()).slice(0, 600_000) : "";
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return "";
    return (await res.text()).slice(0, 600_000);
  } catch {
    return "";
  }
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const JUNK = /\.(png|jpe?g|gif|webp|svg|css|js)$|@(example|domain|email|sentry|wixpress|sentry-next)\.|^(u00|x22)|noreply|no-reply/i;

export function extractEmails(html: string): string[] {
  const decoded = html.replace(/&#64;|&#x40;|\[at\]|\(at\)/gi, "@").replace(/%40/g, "@");
  const found = (decoded.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase().replace(/^mailto:/, ""));
  return [...new Set(found.filter((e) => !JUNK.test(e) && e.length <= 100))].slice(0, 5);
}

export async function findEmails(website: string): Promise<string[]> {
  const home = await safeUrl(website);
  if (!home) throw new ApiError("VALIDATION_ERROR", "That website address can't be checked.");
  const html = await fetchPage(home);
  let emails = extractEmails(html);
  if (!emails.length) {
    const contact = html.match(/href=["']([^"']*contact[^"']*)["']/i)?.[1];
    const cu = contact ? await safeUrl(new URL(contact, home).toString()) : null;
    if (cu && cu.hostname === home.hostname) emails = extractEmails(await fetchPage(cu));
  }
  return emails;
}

// ---------------------------------------------------------------------------
// Adding prospects to Leads
// ---------------------------------------------------------------------------
export const addSchema = z
  .object({
    city: z.string().trim().max(80).default(""),
    prospects: z
      .array(z.object({ placeId: z.string().max(300), name: z.string().trim().max(120), phone: z.string().trim().max(20), website: z.string().trim().max(300).default(""), email: z.string().trim().toLowerCase().email().or(z.literal("")).default(""), category: z.string().trim().max(80).default(""), rating: z.number().nullable().default(null), reviews: z.number().default(0) }).strict())
      .min(1)
      .max(60),
  })
  .strict();

export async function addProspects(input: z.infer<typeof addSchema>, actorId: string, req?: Request) {
  let added = 0;
  let existing = 0;
  const skipped: string[] = [];
  for (const p of input.prospects) {
    if (!normalizePhone(p.phone)) {
      skipped.push(p.name);
      continue;
    }
    const r = await recordLead(
      { phone: p.phone, business: p.name, city: input.city, email: p.email, website: p.website, placeId: p.placeId, source: "maps", campaign: p.category, note: `Found on Google Maps${p.category ? ` (${p.category})` : ""}${p.rating ? ` · ${p.rating}★ from ${p.reviews} reviews` : ""}` },
      actorId,
      req
    );
    if (r.created) added++;
    else existing++;
  }
  return { added, existing, skipped };
}

// ---------------------------------------------------------------------------
// Settings, WhatsApp queue and email batches
// ---------------------------------------------------------------------------
const SETTINGS_KEY = "outreach:settings";
export const settingsSchema = z
  .object({
    whatsappTemplate: z.string().trim().min(20).max(1000),
    emailSubject: z.string().trim().min(5).max(150),
    emailBody: z.string().trim().min(30).max(4000),
    senderDetails: z.string().trim().max(300),
    dailyWhatsApp: z.coerce.number().int().min(1).max(100),
    dailyEmail: z.coerce.number().int().min(1).max(300),
  })
  .strict();
export type OutreachSettings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: OutreachSettings = {
  whatsappTemplate:
    "Hi {name}, I'm Gurjeet from MECGURA, Punjab 🙏 I saw {business} on Google Maps. We set up WhatsApp for local businesses so every customer message gets an instant reply, with order updates and offers. Can I show you a 10-minute demo? If not interested, just say no and I won't message again.",
  emailSubject: "Quick idea for {business}'s WhatsApp",
  emailBody:
    "Hi {name},\n\nI'm Gurjeet from MECGURA. I found {business} on Google Maps and wanted to share one idea: many {category} owners in {city} lose enquiries that come on WhatsApp after hours.\n\nWe set up the official WhatsApp Business API on your existing number so every message gets an instant reply, with prices, timings, bookings and festival offers, in Punjabi, Hindi or English.\n\nWould a free 10-minute demo this week be useful? Just reply to this email.\n\nThanks,\nGurjeet Singh\nMECGURA · mecgura.tech · +91 78377 22567",
  senderDetails: "MECGURA, Punjab, India · mecgura.tech",
  dailyWhatsApp: 40,
  dailyEmail: 100,
};

export async function getOutreachSettings(): Promise<OutreachSettings> {
  try {
    const p = settingsSchema.partial().safeParse(JSON.parse(await getSetting(SETTINGS_KEY, "{}")));
    return { ...DEFAULT_SETTINGS, ...(p.success ? p.data : {}) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export async function saveOutreachSettings(input: OutreachSettings, actorId: string, req?: Request) {
  await setSetting(SETTINGS_KEY, JSON.stringify(input));
  await audit({ action: "marketing.lead_saved", actorUserId: actorId, targetType: "outreach_settings", req });
  return getOutreachSettings();
}

const startOfIstDay = (now = new Date()) => {
  const d = new Date(now.getTime() + 5.5 * 3_600_000);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - 5.5 * 3_600_000);
};

/** Maps leads nobody has contacted yet, plus today's WhatsApp and email counts against the daily limits. */
export async function outreachQueue() {
  const settings = await getOutreachSettings();
  const since = startOfIstDay();
  const [queue, whatsappToday, emailToday, emailable] = await Promise.all([
    db.marketingLead.findMany({ where: { source: "maps", stage: "new", lastContactAt: null }, orderBy: { createdAt: "asc" }, take: 200 }),
    db.marketingLeadActivity.count({ where: { kind: "whatsapp", createdAt: { gte: since } } }),
    db.marketingLeadActivity.count({ where: { kind: "email", createdAt: { gte: since } } }),
    db.marketingLead.count({ where: { email: { not: "" }, emailOptOut: false, stage: { notIn: ["won", "lost"] }, OR: [{ lastEmailedAt: null }, { lastEmailedAt: { lt: new Date(Date.now() - 7 * 86_400_000) } }] } }),
  ]);
  return {
    settings,
    emailReady: isEmailConfigured(),
    queue: queue.map((l) => ({ id: l.id, name: l.name, business: l.business, city: l.city, phone: l.phone, email: l.email, website: l.website, category: l.campaign, createdAt: l.createdAt })),
    whatsappToday,
    whatsappLeft: Math.max(0, settings.dailyWhatsApp - whatsappToday),
    emailToday,
    emailLeft: Math.max(0, settings.dailyEmail - emailToday),
    emailable,
  };
}

const secret = () => process.env.AUTH_SECRET || "dev-secret";
export const unsubscribeToken = (leadId: string) => createHmac("sha256", secret()).update(`unsub:${leadId}`).digest("base64url").slice(0, 32);
export function unsubscribeUrl(leadId: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://mecgura.tech").replace(/\/$/, "");
  return `${base}/api/m/unsubscribe?l=${encodeURIComponent(leadId)}&t=${unsubscribeToken(leadId)}`;
}

/** Marks a lead as unsubscribed from outreach email (public link in every email). */
export async function unsubscribe(leadId: string, token: string) {
  const want = Buffer.from(unsubscribeToken(leadId));
  const got = Buffer.from(token);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  const r = await db.marketingLead.updateMany({ where: { id: leadId }, data: { emailOptOut: true } });
  if (r.count) await db.marketingLeadActivity.create({ data: { leadId, kind: "note", text: "Unsubscribed from outreach email" } });
  return r.count > 0;
}

export const emailBatchSchema = z.object({ leadIds: z.array(z.string().min(1).max(64)).min(1).max(300) }).strict();

/**
 * Sends the saved outreach email to the chosen leads, within today's limit. Skips leads without an email, those who
 * unsubscribed, are won/lost, or were emailed in the last 7 days. Every email names the sender and has an
 * unsubscribe link.
 */
export async function sendEmailBatch(input: z.infer<typeof emailBatchSchema>, actorId: string, req?: Request) {
  if (!isEmailConfigured() && process.env.NODE_ENV === "production") throw new ApiError("CONFLICT", "Email isn't set up yet. Add RESEND_API_KEY and EMAIL_FROM in Vercel, then redeploy.");
  const q = await outreachQueue();
  if (q.emailLeft <= 0) throw new ApiError("RATE_LIMITED", `Today's email limit (${q.settings.dailyEmail}) is used. Send more tomorrow.`);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const leads = await db.marketingLead.findMany({
    where: { id: { in: input.leadIds }, email: { not: "" }, emailOptOut: false, stage: { notIn: ["won", "lost"] }, OR: [{ lastEmailedAt: null }, { lastEmailedAt: { lt: weekAgo } }] },
    take: q.emailLeft,
  });
  let sent = 0;
  let failed = 0;
  for (const l of leads) {
    const vars = { name: l.name, business: l.business, city: l.city, category: l.campaign.toLowerCase() };
    const subject = fillTemplate(q.settings.emailSubject, vars);
    const text = `${fillTemplate(q.settings.emailBody, vars)}\n\n—\n${q.settings.senderDetails}\nYou're receiving this because ${l.business || "your business"} is listed publicly on Google Maps. Not interested? Unsubscribe in one click: ${unsubscribeUrl(l.id)}`;
    const r = await sendMail(l.email, subject, text);
    if (r.delivered) {
      sent++;
      await db.marketingLead.update({
        where: { id: l.id },
        data: { lastEmailedAt: new Date(), lastContactAt: new Date(), ...(l.stage === "new" ? { stage: "contacted" } : {}), activities: { create: { kind: "email", actorId, text: `Outreach email sent: "${subject}"` } } },
      });
    } else failed++;
  }
  await audit({ action: "marketing.lead_saved", actorUserId: actorId, targetType: "outreach_email", metadata: { sent, failed, chosen: input.leadIds.length }, req });
  return { sent, failed, skipped: input.leadIds.length - leads.length, left: Math.max(0, q.emailLeft - sent) };
}
