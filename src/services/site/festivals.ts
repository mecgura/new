import { z } from "zod";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * Festival calendar the Super Admin edits from /admin/festivals. On a festival's days the public
 * home page shows a greeting banner (with an optional photo and offer) and a short screen effect,
 * and client workspaces get a one-time greeting. Dates move every year, so they live in the
 * database, not in code. Photos are stored one row each so the list stays small.
 */
const KEY = "festivals";
const PHOTO_KEY = (id: string) => `festival-photo:${id}`;

export const FESTIVAL_EFFECTS = ["fireworks", "diyas", "petals", "colors", "snow", "confetti", "none"] as const;
export type FestivalEffect = (typeof FESTIVAL_EFFECTS)[number];
export const EFFECT_LABELS: Record<FestivalEffect, string> = {
  fireworks: "Fireworks (patake)",
  diyas: "Diyas and sparkles",
  petals: "Falling flower petals",
  colors: "Holi colours",
  snow: "Snow",
  confetti: "Confetti",
  none: "No effect",
};

/** Colour theme the public website switches to while a festival offer runs. */
export const FESTIVAL_THEMES = ["auto", "gold", "saffron", "maroon", "holi", "winter", "green", "tricolour", "none"] as const;
export type FestivalTheme = (typeof FESTIVAL_THEMES)[number];
export const THEME_LABELS: Record<FestivalTheme, string> = {
  auto: "Automatic (from the festival)",
  gold: "Gold & diya glow (Diwali, Gurpurab, Lohri)",
  saffron: "Saffron (Dussehra, Vaisakhi)",
  maroon: "Maroon & rose (Karwa Chauth, Rakhi)",
  holi: "Holi colours",
  winter: "Winter blue (Christmas, New Year)",
  green: "Crescent green (Eid)",
  tricolour: "Tricolour (Republic / Independence Day)",
  none: "Keep the normal website colours",
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-08.");

export const festivalSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().trim().min(1).max(60),
  emoji: z.string().trim().max(8).default(""),
  start: isoDate,
  days: z.coerce.number().int().min(1).max(30).default(1),
  greeting: z.string().trim().max(240).default(""),
  offer: z.string().trim().max(200).default(""),
  offerCode: z.string().trim().max(30).default(""),
  effect: z.enum(FESTIVAL_EFFECTS).default("confetti"),
  showOnSite: z.boolean().default(true),
  showToClients: z.boolean().default(true),
  hasPhoto: z.boolean().default(false),
  /** Days before the festival the website offer starts (pre-festival advertising). */
  leadDays: z.coerce.number().int().min(0).max(14).default(3),
  /** Festive discount on MECGURA plans, shown on the website. 0 = no discount. */
  discountPercent: z.coerce.number().int().min(0).max(90).default(10),
  /** Show the discounted price on the pricing cards. */
  applyToPlans: z.boolean().default(true),
  theme: z.enum(FESTIVAL_THEMES).default("auto"),
});
export type Festival = z.infer<typeof festivalSchema>;

export const festivalsSchema = z.object({ enabled: z.boolean(), festivals: z.array(festivalSchema).max(60) });
export type FestivalSettings = z.infer<typeof festivalsSchema>;

const f = (id: string, name: string, emoji: string, start: string, days: number, effect: FestivalEffect, greeting: string, discountPercent = 10, offerCode = ""): Festival => ({
  id, name, emoji, start, days, effect, greeting, offer: "", offerCode, showOnSite: true, showToClients: true, hasPhoto: false, leadDays: 3, discountPercent, applyToPlans: true, theme: "auto",
});

/** Starting list. Dates of lunar festivals are approximate: check them once in the admin panel. */
export const DEFAULT_FESTIVALS: FestivalSettings = {
  enabled: true,
  festivals: [
    f("dussehra-2026", "Dussehra", "🏹", "2026-10-20", 1, "fireworks", "Wishing you a Dussehra full of victory, courage and new beginnings."),
    f("karwa-chauth-2026", "Karwa Chauth", "🌕", "2026-10-29", 1, "petals", "Wishing you love, togetherness and blessings this Karwa Chauth."),
    f("dhanteras-2026", "Dhanteras", "🪙", "2026-11-06", 1, "diyas", "May this Dhanteras bring wealth, health and prosperity to your business.", 15, "DHAN15"),
    f("diwali-2026", "Diwali & Bandi Chhor Divas", "🪔", "2026-11-07", 3, "fireworks", "Wishing you and your family a bright, safe and prosperous Diwali and Bandi Chhor Divas.", 20, "DIWALI20"),
    f("gurpurab-2026", "Guru Nanak Gurpurab", "🙏", "2026-11-24", 1, "diyas", "Warm wishes on Guru Nanak Dev Ji's Gurpurab. May his teachings guide us all."),
    f("christmas-2026", "Christmas", "🎄", "2026-12-24", 2, "snow", "Merry Christmas! Wishing you joy, peace and a wonderful season."),
    f("new-year-2027", "New Year", "🎉", "2026-12-31", 2, "fireworks", "Happy New Year 2027! Here's to more customers and bigger wins.", 15, "NEWYEAR15"),
    f("lohri-2027", "Lohri", "🔥", "2027-01-13", 1, "diyas", "Happy Lohri! May the bonfire bring warmth, happiness and a great harvest."),
    f("republic-day-2027", "Republic Day", "🇮🇳", "2027-01-26", 1, "confetti", "Happy Republic Day! Proud to build for Indian businesses."),
    f("holi-2027", "Holi", "🎨", "2027-03-21", 2, "colors", "Happy Holi! Wishing you a life full of colours."),
    f("eid-2027", "Eid al-Fitr", "🌙", "2027-03-10", 1, "petals", "Eid Mubarak! Wishing you peace, joy and prosperity."),
    f("vaisakhi-2027", "Vaisakhi", "🌾", "2027-04-14", 1, "confetti", "Happy Vaisakhi! Wishing you a season of growth and new beginnings."),
    f("independence-day-2027", "Independence Day", "🇮🇳", "2027-08-15", 1, "confetti", "Happy Independence Day!"),
    f("raksha-bandhan-2027", "Raksha Bandhan", "🪢", "2027-08-17", 1, "petals", "Happy Raksha Bandhan! Celebrating the bond that protects and cares."),
  ],
};

export async function getFestivals(): Promise<FestivalSettings> {
  const raw = await getSetting(KEY, "");
  if (!raw) return DEFAULT_FESTIVALS;
  try {
    const parsed = festivalsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_FESTIVALS;
  } catch {
    return DEFAULT_FESTIVALS;
  }
}

export async function saveFestivals(input: FestivalSettings): Promise<FestivalSettings> {
  // A festival only says it has a photo when one is actually stored.
  const festivals = await Promise.all(input.festivals.map(async (x) => ({ ...x, hasPhoto: Boolean(await getSetting(PHOTO_KEY(x.id), "")) })));
  const value = { ...input, festivals };
  await setSetting(KEY, JSON.stringify(value));
  return value;
}

export const photoSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{1,40}$/),
  photo: z
    .string()
    .max(420_000)
    .refine((v) => v === "" || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v), "Photo must be a JPEG, PNG or WebP image."),
});

export async function saveFestivalPhoto(id: string, photo: string) {
  await setSetting(PHOTO_KEY(id), photo);
  const s = await getFestivals();
  if (s.festivals.some((x) => x.id === id)) {
    await setSetting(KEY, JSON.stringify({ ...s, festivals: s.festivals.map((x) => (x.id === id ? { ...x, hasPhoto: Boolean(photo) } : x)) }));
  }
}

/** Raw photo bytes for the public image route, or null. */
export async function festivalPhoto(id: string): Promise<{ type: string; bytes: Buffer } | null> {
  if (!/^[a-z0-9-]{1,40}$/.test(id)) return null;
  const v = await getSetting(PHOTO_KEY(id), "");
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(v);
  return m ? { type: m[1], bytes: Buffer.from(m[2], "base64") } : null;
}

const IST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
/** Today's date in India as YYYY-MM-DD. */
export const istToday = (now = new Date()) => IST.format(now);

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const festivalEnd = (x: Festival) => addDays(x.start, x.days - 1);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function activeFestival(s: FestivalSettings, audience: "site" | "clients", today = istToday()): Festival | null {
  if (!s.enabled) return null;
  return (
    s.festivals
      .filter((x) => (audience === "site" ? x.showOnSite : x.showToClients))
      .filter((x) => x.start <= today && today <= festivalEnd(x))
      .sort((a, b) => b.start.localeCompare(a.start))[0] ?? null
  );
}

export function upcomingFestivals(s: FestivalSettings, today = istToday(), limit = 5): (Festival & { inDays: number })[] {
  if (!s.enabled) return [];
  return s.festivals
    .filter((x) => x.showOnSite && festivalEnd(x) >= today)
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, limit)
    .map((x) => ({ ...x, inDays: Math.max(0, daysBetween(today, x.start)) }));
}

const THEME_BY_NAME: [RegExp, Exclude<FestivalTheme, "auto">][] = [
  [/diwali|dhanteras|deepavali|gurpurab|gurupurab|lohri|bandi/i, "gold"],
  [/dussehra|dasara|vaisakhi|baisakhi|navratri|ganesh|pongal|onam/i, "saffron"],
  [/karwa|raksha|rakhi|teej|valentine/i, "maroon"],
  [/holi/i, "holi"],
  [/christmas|new year/i, "winter"],
  [/eid|ramadan|ramzan/i, "green"],
  [/republic|independence/i, "tricolour"],
];
const THEME_BY_EFFECT: Record<FestivalEffect, Exclude<FestivalTheme, "auto">> = { fireworks: "gold", diyas: "gold", petals: "maroon", colors: "holi", snow: "winter", confetti: "saffron", none: "none" };

/** The website colour theme for a festival ("auto" is worked out from its name, then its effect). */
export function themeFor(x: Festival): Exclude<FestivalTheme, "auto"> {
  if (x.theme !== "auto") return x.theme;
  return THEME_BY_NAME.find(([re]) => re.test(`${x.id} ${x.name}`))?.[1] ?? THEME_BY_EFFECT[x.effect];
}

/** What the offer says: the admin's own text, or "N% off on all MECGURA plans". */
export function offerText(x: Festival): string {
  if (x.offer.trim()) return x.offer.trim();
  return x.discountPercent > 0 ? `${x.discountPercent}% off on all MECGURA plans` : "";
}

export type FestivalPromo = { festival: Festival; phase: "pre" | "live"; daysToStart: number; offer: string; theme: Exclude<FestivalTheme, "auto">; startsOn: string; endsOn: string };

/**
 * The festival the public website should advertise today. A running festival wins; otherwise the next one whose
 * advertising window (leadDays before its start) has opened. Runs by itself every day, no switch to flip.
 */
export function festivalPromo(s: FestivalSettings, today = istToday()): FestivalPromo | null {
  const live = activeFestival(s, "site", today);
  const pick = (x: Festival, phase: "pre" | "live"): FestivalPromo => ({ festival: x, phase, daysToStart: Math.max(0, daysBetween(today, x.start)), offer: offerText(x), theme: themeFor(x), startsOn: x.start, endsOn: festivalEnd(x) });
  if (live) return pick(live, "live");
  if (!s.enabled) return null;
  const next = s.festivals
    .filter((x) => x.showOnSite && x.leadDays > 0 && x.start > today && addDays(x.start, -x.leadDays) <= today)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  return next ? pick(next, "pre") : null;
}

/** Plan price after the festive discount (paise, rounded down to whole rupees). */
export const festivePrice = (paise: number, percent: number) => Math.floor((paise * (100 - percent)) / 100 / 100) * 100;
