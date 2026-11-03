import { z } from "zod";
import sharp from "sharp";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * The home page hero: six industry slides whose headline, owner photo and WhatsApp chat change together. Text and
 * photo are edited in Admin → Website; the chats are written here. Photos are uploaded or picked from AI studio,
 * re-encoded to a small WebP and served publicly only while a slide uses them.
 */
export const SLIDE_IDS = ["retail", "salon", "food", "education", "healthcare", "realestate"] as const;
export type SlideId = (typeof SLIDE_IDS)[number];

export type ChatLine = { from: "customer" | "business"; text: string; time: string };
type SlideDefaults = { category: string; business: string; headline: string; description: string; photoHint: string; chat: ChatLine[] };

export const SLIDE_DEFAULTS: Record<SlideId, SlideDefaults> = {
  retail: {
    category: "Retail & kirana",
    business: "Gupta General Store",
    headline: "WhatsApp that replies for your shop.",
    description: "Never miss a customer enquiry. Manage orders, product questions and customer conversations automatically.",
    photoHint: "Indian male grocery shop owner at his counter",
    chat: [
      { from: "customer", text: "Bhaiya, Aashirvaad atta 10 kg available hai?", time: "7:42 pm" },
      { from: "business", text: "Yes ji, in stock ✅ ₹465. Home delivery in 30 minutes. Shall I add it to your order?", time: "7:42 pm" },
      { from: "customer", text: "Haan, add kar do. Same address.", time: "7:43 pm" },
      { from: "business", text: "Done! Order #2481 confirmed 🛒 Pay on delivery.", time: "7:43 pm" },
    ],
  },
  salon: {
    category: "Salon & beauty",
    business: "Glow Studio",
    headline: "WhatsApp that books for your salon.",
    description: "Manage appointments, send reminders and respond to customer enquiries automatically.",
    photoHint: "Indian female salon owner in her salon",
    chat: [
      { from: "customer", text: "Hi! Any slot for a haircut on Saturday?", time: "11:05 am" },
      { from: "business", text: "Hi Priya 👋 Saturday has 12:30 pm and 4:00 pm free. Which one suits you?", time: "11:05 am" },
      { from: "customer", text: "4 pm please", time: "11:06 am" },
      { from: "business", text: "Booked ✅ Sat, 4:00 pm with Simran. We'll remind you 2 hours before.", time: "11:06 am" },
    ],
  },
  food: {
    category: "Sweets & food",
    business: "Sharma Sweets",
    headline: "WhatsApp that grows your food business.",
    description: "Share offers, manage orders and connect with customers through smart campaigns.",
    photoHint: "Indian sweet shop owner with trays of mithai",
    chat: [
      { from: "customer", text: "Is my Diwali box order on its way?", time: "4:18 pm" },
      { from: "business", text: "Yes! Order #1197 is out for delivery 🚚 It will reach you in about 25 minutes.", time: "4:18 pm" },
      { from: "customer", text: "Great, thank you!", time: "4:19 pm" },
      { from: "business", text: "Happy Diwali 🪔 Show this chat for 10% off your next order.", time: "4:19 pm" },
    ],
  },
  education: {
    category: "Coaching & education",
    business: "Bright Future Academy",
    headline: "WhatsApp that connects with every student.",
    description: "Handle course enquiries, admission follow-ups and student communication.",
    photoHint: "Indian coaching institute teacher in a classroom",
    chat: [
      { from: "customer", text: "Sir, IELTS batch kab start ho raha hai? Fees?", time: "6:10 pm" },
      { from: "business", text: "Next batch starts 15 Nov, 7–9 am 📚 Fees ₹12,000 for 2 months. Free demo class this Sunday.", time: "6:10 pm" },
      { from: "customer", text: "Demo class mein aana hai", time: "6:12 pm" },
      { from: "business", text: "Seat reserved ✅ Sunday 10 am. Location and syllabus sent below.", time: "6:12 pm" },
    ],
  },
  healthcare: {
    category: "Clinics & healthcare",
    business: "Care Plus Clinic",
    headline: "WhatsApp that cares for your patients.",
    description: "Simplify appointment enquiries, reminders and patient communication.",
    photoHint: "Indian doctor in a clean clinic",
    chat: [
      { from: "customer", text: "Can I see Dr. Mehta tomorrow morning?", time: "8:30 pm" },
      { from: "business", text: "Tomorrow 10:20 am is available. Shall I confirm it for you?", time: "8:30 pm" },
      { from: "customer", text: "Yes please", time: "8:31 pm" },
      { from: "business", text: "Confirmed ✅ Token 7, 10:20 am. Please bring your old reports.", time: "8:31 pm" },
    ],
  },
  realestate: {
    category: "Real estate",
    business: "Sidhu Properties",
    headline: "WhatsApp that turns enquiries into opportunities.",
    description: "Capture property enquiries, respond to leads and follow up with potential buyers.",
    photoHint: "Indian real estate agent outside a new home",
    chat: [
      { from: "customer", text: "Saw your ad. Is the 3BHK in Model Town still available?", time: "1:14 pm" },
      { from: "business", text: "Yes 🏡 3BHK, 1,650 sq ft, ₹78 lakh. Photos and floor plan sent. Want a site visit?", time: "1:14 pm" },
      { from: "customer", text: "Saturday evening?", time: "1:16 pm" },
      { from: "business", text: "Site visit fixed ✅ Sat, 5:30 pm. Our agent will call you on the way.", time: "1:16 pm" },
    ],
  },
};

const KEY = "home:hero";
const slideEdit = z.object({
  headline: z.string().trim().min(5).max(90),
  description: z.string().trim().min(10).max(220),
  photoId: z.string().max(64).default(""),
  enabled: z.boolean().default(true),
});
const storedSchema = z.object({ slides: z.partialRecord(z.enum(SLIDE_IDS), slideEdit.partial()).default({}) });
export const heroTextSchema = z
  .object({ slides: z.partialRecord(z.enum(SLIDE_IDS), slideEdit.pick({ headline: true, description: true, enabled: true }).strict()) })
  .strict();

export type HeroSlide = { id: SlideId; category: string; business: string; headline: string; description: string; photoHint: string; photoUrl: string | null; enabled: boolean; chat: ChatLine[] };

type Stored = { slides: Partial<Record<SlideId, Partial<z.infer<typeof slideEdit>>>> };

async function stored(): Promise<Stored> {
  try {
    const p = storedSchema.safeParse(JSON.parse(await getSetting(KEY, "{}")));
    return p.success ? (p.data as Stored) : { slides: {} };
  } catch {
    return { slides: {} };
  }
}

/** All six slides with any admin edits applied (`enabled` false ones are skipped on the site). */
export async function getHero(): Promise<HeroSlide[]> {
  const s = await stored();
  return SLIDE_IDS.map((id) => {
    const d = SLIDE_DEFAULTS[id];
    const o = s.slides[id] ?? {};
    return {
      id,
      category: d.category,
      business: d.business,
      headline: o.headline || d.headline,
      description: o.description || d.description,
      photoHint: d.photoHint,
      photoUrl: o.photoId ? `/api/site/hero/${id}?v=${o.photoId}` : null,
      enabled: o.enabled ?? true,
      chat: d.chat,
    };
  });
}

export async function saveHeroText(input: z.infer<typeof heroTextSchema>) {
  const s = await stored();
  for (const id of SLIDE_IDS) {
    const t = input.slides[id];
    if (t) s.slides[id] = { ...s.slides[id], ...t };
  }
  if (!SLIDE_IDS.some((id) => s.slides[id]?.enabled ?? true)) throw new ApiError("VALIDATION_ERROR", "Keep at least one slide switched on.");
  await setSetting(KEY, JSON.stringify(s));
  return getHero();
}

export const heroPhotoSchema = z
  .object({
    slide: z.enum(SLIDE_IDS),
    // A data URL from the admin's upload, an AI studio image id, or "" to remove the photo.
    upload: z.string().max(4_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/, "Upload a PNG, JPG or WebP image").optional(),
    imageId: z.string().max(64).regex(/^[A-Za-z0-9_-]*$/).optional(),
  })
  .strict();

/** Sets a slide's photo: resized to fit 900×1125 and saved as WebP so the home page stays fast. */
export async function setHeroPhoto(input: z.infer<typeof heroPhotoSchema>, actorId: string) {
  const s = await stored();
  const prev = s.slides[input.slide]?.photoId ?? "";
  let source: Buffer | null = null;
  if (input.upload) source = Buffer.from(input.upload.slice(input.upload.indexOf(",") + 1), "base64");
  else if (input.imageId) {
    const img = await db.marketingImage.findUnique({ where: { id: input.imageId }, select: { data: true } });
    if (!img) throw new ApiError("NOT_FOUND", "Image not found.");
    source = Buffer.from(img.data);
  }
  let photoId = "";
  if (source) {
    let webp: Buffer;
    try {
      webp = await sharp(source).rotate().resize(900, 1125, { fit: "cover", position: "attention" }).webp({ quality: 80 }).toBuffer();
    } catch {
      throw new ApiError("VALIDATION_ERROR", "That file isn't an image we can read.");
    }
    const saved = await db.marketingImage.create({ data: { provider: "hero", prompt: `Hero photo: ${SLIDE_DEFAULTS[input.slide].category}`, aspect: "post", mimeType: "image/webp", data: new Uint8Array(webp), createdById: actorId } });
    photoId = saved.id;
  }
  s.slides[input.slide] = { ...s.slides[input.slide], photoId };
  await setSetting(KEY, JSON.stringify(s));
  if (prev) await db.marketingImage.deleteMany({ where: { id: prev, provider: "hero" } });
  return getHero();
}

/** The public photo of a slide (only the one in use, never other gallery images). */
export async function heroPhoto(slide: string) {
  if (!(SLIDE_IDS as readonly string[]).includes(slide)) return null;
  const id = (await stored()).slides[slide as SlideId]?.photoId;
  if (!id) return null;
  return db.marketingImage.findFirst({ where: { id, provider: "hero" }, select: { data: true, mimeType: true } });
}
