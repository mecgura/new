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
});
export type Festival = z.infer<typeof festivalSchema>;

export const festivalsSchema = z.object({ enabled: z.boolean(), festivals: z.array(festivalSchema).max(60) });
export type FestivalSettings = z.infer<typeof festivalsSchema>;

const f = (id: string, name: string, emoji: string, start: string, days: number, effect: FestivalEffect, greeting: string): Festival => ({
  id, name, emoji, start, days, effect, greeting, offer: "", offerCode: "", showOnSite: true, showToClients: true, hasPhoto: false,
});

/** Starting list. Dates of lunar festivals are approximate: check them once in the admin panel. */
export const DEFAULT_FESTIVALS: FestivalSettings = {
  enabled: true,
  festivals: [
    f("dussehra-2026", "Dussehra", "🏹", "2026-10-20", 1, "fireworks", "Wishing you a Dussehra full of victory, courage and new beginnings."),
    f("karwa-chauth-2026", "Karwa Chauth", "🌕", "2026-10-29", 1, "petals", "Wishing you love, togetherness and blessings this Karwa Chauth."),
    f("dhanteras-2026", "Dhanteras", "🪙", "2026-11-06", 1, "diyas", "May this Dhanteras bring wealth, health and prosperity to your business."),
    f("diwali-2026", "Diwali & Bandi Chhor Divas", "🪔", "2026-11-07", 3, "fireworks", "Wishing you and your family a bright, safe and prosperous Diwali and Bandi Chhor Divas."),
    f("gurpurab-2026", "Guru Nanak Gurpurab", "🙏", "2026-11-24", 1, "diyas", "Warm wishes on Guru Nanak Dev Ji's Gurpurab. May his teachings guide us all."),
    f("christmas-2026", "Christmas", "🎄", "2026-12-24", 2, "snow", "Merry Christmas! Wishing you joy, peace and a wonderful season."),
    f("new-year-2027", "New Year", "🎉", "2026-12-31", 2, "fireworks", "Happy New Year 2027! Here's to more customers and bigger wins."),
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
