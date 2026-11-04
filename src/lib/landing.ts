// Landing page blocks: one zod schema per block type, the industry starter templates and helpers.
// Pure module (no DB) so the builder, the public page, the API and tests share it.
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max).default("");
const httpsUrl = z.string().trim().max(600).refine((u) => u === "" || /^https:\/\/\S+$/i.test(u) || /^\/api\/lp-image\/[a-z0-9]+$/i.test(u), "Use an https:// link").default("");
const action = z.enum(["whatsapp", "form", "link"]).default("whatsapp");
const id = z.string().regex(/^[a-z0-9]{4,24}$/i);

export const BLOCK_TYPES = ["hero", "text", "features", "services", "pricing", "image", "video", "testimonials", "faq", "form", "cta", "qr", "contact"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: "Hero (headline + button)",
  text: "Text",
  features: "Features",
  services: "Services with prices",
  pricing: "Pricing plans",
  image: "Image",
  video: "YouTube video",
  testimonials: "Customer quotes",
  faq: "FAQ",
  form: "Lead form",
  cta: "Call to action",
  qr: "QR code",
  contact: "Address & timings",
};

const item = z.object({ title: text(80), text: text(300) }).strict();

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("hero"), heading: text(120), subheading: text(300), imageUrl: httpsUrl, buttonLabel: text(40), action, link: httpsUrl }).strict(),
  z.object({ id, type: z.literal("text"), heading: text(120), body: text(3000) }).strict(),
  z.object({ id, type: z.literal("features"), heading: text(120), items: z.array(item).max(12).default([]) }).strict(),
  z.object({ id, type: z.literal("services"), heading: text(120), items: z.array(z.object({ title: text(80), text: text(300), price: text(40) }).strict()).max(20).default([]) }).strict(),
  z.object({ id, type: z.literal("pricing"), heading: text(120), plans: z.array(z.object({ name: text(60), price: text(40), period: text(30), features: z.array(text(100)).max(12).default([]), highlight: z.boolean().default(false) }).strict()).max(4).default([]), buttonLabel: text(40), action }).strict(),
  z.object({ id, type: z.literal("image"), url: httpsUrl, alt: text(160), caption: text(200) }).strict(),
  z.object({ id, type: z.literal("video"), heading: text(120), youtubeUrl: z.string().trim().max(200).refine((u) => u === "" || youtubeId(u) !== null, "Paste a YouTube link").default("") }).strict(),
  z.object({ id, type: z.literal("testimonials"), heading: text(120), items: z.array(z.object({ quote: text(400), name: text(60) }).strict()).max(9).default([]) }).strict(),
  z.object({ id, type: z.literal("faq"), heading: text(120), items: z.array(z.object({ q: text(200), a: text(800) }).strict()).max(15).default([]) }).strict(),
  z
    .object({
      id,
      type: z.literal("form"),
      heading: text(120),
      text: text(300),
      askEmail: z.boolean().default(false),
      askMessage: z.boolean().default(true),
      messageLabel: text(60),
      submitLabel: text(40),
      consentText: text(300),
      successMessage: text(300),
      tag: text(40),
      createDeal: z.boolean().default(false),
    })
    .strict(),
  z.object({ id, type: z.literal("cta"), heading: text(120), text: text(300), buttonLabel: text(40), action, link: httpsUrl }).strict(),
  z.object({ id, type: z.literal("qr"), heading: text(120), text: text(200) }).strict(),
  z.object({ id, type: z.literal("contact"), heading: text(120), address: text(300), timings: text(300), mapsUrl: httpsUrl, phone: text(20) }).strict(),
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;

export const blocksSchema = z.array(blockSchema).max(40);

export const themeSchema = z
  .object({
    accent: z.enum(["emerald", "saffron", "rose", "blue", "violet", "slate"]).default("emerald"),
    whatsapp: z.string().trim().max(20).regex(/^\+?\d{0,15}$/, "Digits only, with country code").default(""),
    whatsappText: text(200),
    floatingWhatsApp: z.boolean().default(true),
  })
  .strict();
export type Theme = z.infer<typeof themeSchema>;
export const DEFAULT_THEME: Theme = { accent: "emerald", whatsapp: "", whatsappText: "", floatingWhatsApp: true };

export const ACCENTS: Record<Theme["accent"], { bg: string; text: string; soft: string; ring: string }> = {
  emerald: { bg: "#047857", text: "#ffffff", soft: "#ecfdf5", ring: "#10b981" },
  saffron: { bg: "#ea580c", text: "#ffffff", soft: "#fff7ed", ring: "#f97316" },
  rose: { bg: "#be123c", text: "#ffffff", soft: "#fff1f2", ring: "#f43f5e" },
  blue: { bg: "#1d4ed8", text: "#ffffff", soft: "#eff6ff", ring: "#3b82f6" },
  violet: { bg: "#6d28d9", text: "#ffffff", soft: "#f5f3ff", ring: "#8b5cf6" },
  slate: { bg: "#0f172a", text: "#ffffff", soft: "#f1f5f9", ring: "#334155" },
};

export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

export const slugSchema = z.string().trim().toLowerCase().min(2).max(60).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes");
export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";

export const newBlockId = () => Math.random().toString(36).slice(2, 10);

export function defaultBlock(type: BlockType): Block {
  const i = newBlockId();
  switch (type) {
    case "hero":
      return { id: i, type, heading: "Your headline here", subheading: "One line on what you offer and who it's for.", imageUrl: "", buttonLabel: "Chat on WhatsApp", action: "whatsapp", link: "" };
    case "text":
      return { id: i, type, heading: "About us", body: "Tell visitors who you are and why customers choose you." };
    case "features":
      return { id: i, type, heading: "Why choose us", items: [{ title: "Quick service", text: "" }, { title: "Fair prices", text: "" }, { title: "Trusted locally", text: "" }] };
    case "services":
      return { id: i, type, heading: "Services", items: [{ title: "Service one", text: "", price: "₹" }] };
    case "pricing":
      return { id: i, type, heading: "Plans", plans: [{ name: "Basic", price: "₹999", period: "/month", features: ["Feature"], highlight: false }, { name: "Popular", price: "₹1,999", period: "/month", features: ["Everything in Basic"], highlight: true }], buttonLabel: "Get started", action: "whatsapp" };
    case "image":
      return { id: i, type, url: "", alt: "", caption: "" };
    case "video":
      return { id: i, type, heading: "", youtubeUrl: "" };
    case "testimonials":
      return { id: i, type, heading: "What customers say", items: [] };
    case "faq":
      return { id: i, type, heading: "Questions", items: [{ q: "What are your timings?", a: "" }] };
    case "form":
      return { id: i, type, heading: "Get a call back", text: "Leave your number and we'll reply on WhatsApp.", askEmail: false, askMessage: true, messageLabel: "What do you need?", submitLabel: "Send", consentText: "I agree to receive updates on WhatsApp. I can reply STOP anytime.", successMessage: "Thank you! We'll contact you shortly.", tag: "Landing page lead", createDeal: false };
    case "cta":
      return { id: i, type, heading: "Ready to start?", text: "", buttonLabel: "Chat on WhatsApp", action: "whatsapp", link: "" };
    case "qr":
      return { id: i, type, heading: "Scan to open this page", text: "" };
    case "contact":
      return { id: i, type, heading: "Visit us", address: "", timings: "", mapsUrl: "", phone: "" };
  }
}

type Starter = { id: string; name: string; description: string; title: string; theme: Partial<Theme>; blocks: () => Block[] };
const b = <T extends BlockType>(type: T, p: Partial<BlockOf<T>>) => ({ ...defaultBlock(type), ...p }) as Block;

export const STARTERS: Starter[] = [
  {
    id: "blank",
    name: "Blank page",
    description: "Hero, form and contact. Build the rest yourself.",
    title: "New page",
    theme: {},
    blocks: () => [defaultBlock("hero"), defaultBlock("form"), defaultBlock("contact")],
  },
  {
    id: "salon",
    name: "Salon & spa",
    description: "Services with prices, bridal enquiry form, timings.",
    title: "Book your appointment",
    theme: { accent: "rose" },
    blocks: () => [
      b("hero", { heading: "Look your best this season", subheading: "Hair, skin and bridal makeup by trained stylists. Book on WhatsApp in a minute.", buttonLabel: "Book on WhatsApp" }),
      b("services", { heading: "Popular services", items: [{ title: "Haircut & styling", text: "", price: "from ₹" }, { title: "Facial", text: "", price: "from ₹" }, { title: "Bridal makeup", text: "Trial included", price: "from ₹" }] }),
      b("form", { heading: "Bridal or party enquiry", messageLabel: "Date and service", tag: "Bridal enquiry", createDeal: true }),
      b("contact", { heading: "Visit us" }),
    ],
  },
  {
    id: "clinic",
    name: "Clinic / doctor",
    description: "Treatments, appointment request, FAQ, timings.",
    title: "Book a consultation",
    theme: { accent: "blue" },
    blocks: () => [
      b("hero", { heading: "Care you can trust, close to home", subheading: "Consultations by appointment. Send us a message and we'll confirm a time.", buttonLabel: "Request appointment", action: "form" }),
      b("features", { heading: "Why patients choose us", items: [{ title: "Experienced doctors", text: "" }, { title: "On-time appointments", text: "" }, { title: "Clean, modern clinic", text: "" }] }),
      b("form", { heading: "Request an appointment", messageLabel: "Preferred day and concern", tag: "Appointment request" }),
      b("faq", { heading: "Common questions", items: [{ q: "Do I need an appointment?", a: "" }, { q: "What are the consultation charges?", a: "" }] }),
      b("contact", { heading: "Clinic timings" }),
    ],
  },
  {
    id: "realestate",
    name: "Real estate project",
    description: "Project highlights, video tour, site-visit form.",
    title: "Book a site visit",
    theme: { accent: "slate" },
    blocks: () => [
      b("hero", { heading: "2 & 3 BHK homes in a prime location", subheading: "Book a free site visit. Price list and floor plans on WhatsApp.", buttonLabel: "Get price list" }),
      b("features", { heading: "Project highlights", items: [{ title: "Approved project", text: "" }, { title: "Near schools & market", text: "" }, { title: "Easy loan options", text: "" }] }),
      b("video", { heading: "Video walkthrough" }),
      b("form", { heading: "Book a site visit", askEmail: true, messageLabel: "Budget and preferred date", tag: "Site visit", createDeal: true }),
      b("contact", { heading: "Site office" }),
    ],
  },
  {
    id: "coaching",
    name: "Coaching / IELTS",
    description: "Courses and fees, demo class form, FAQ.",
    title: "Book a free demo class",
    theme: { accent: "violet" },
    blocks: () => [
      b("hero", { heading: "Get your target band with expert coaching", subheading: "Small batches, daily practice tests and personal feedback.", buttonLabel: "Book free demo", action: "form" }),
      b("pricing", { heading: "Courses", plans: [{ name: "Regular", price: "₹", period: "/month", features: ["Daily classes", "Weekly mock test"], highlight: false }, { name: "Fast track", price: "₹", period: "/month", features: ["Extra speaking practice", "Personal mentor"], highlight: true }], buttonLabel: "Ask on WhatsApp" }),
      b("form", { heading: "Book a free demo class", messageLabel: "Course and preferred batch", tag: "Demo class" }),
      b("faq", { heading: "Questions", items: [{ q: "When do new batches start?", a: "" }] }),
      b("contact", { heading: "Centre address" }),
    ],
  },
  {
    id: "restaurant",
    name: "Restaurant / cafe",
    description: "Menu highlights, order on WhatsApp, timings and map.",
    title: "Order on WhatsApp",
    theme: { accent: "saffron" },
    blocks: () => [
      b("hero", { heading: "Fresh food, delivered hot", subheading: "Order on WhatsApp. Pickup and home delivery.", buttonLabel: "Order on WhatsApp" }),
      b("services", { heading: "Customer favourites", items: [{ title: "Dish one", text: "", price: "₹" }, { title: "Dish two", text: "", price: "₹" }] }),
      b("cta", { heading: "Hungry already?", buttonLabel: "Order now" }),
      b("contact", { heading: "Find us" }),
    ],
  },
];

export const starter = (id: string) => STARTERS.find((s) => s.id === id) ?? null;

export function parseBlocks(raw: string): Block[] {
  try {
    const p = blocksSchema.safeParse(JSON.parse(raw));
    return p.success ? p.data : [];
  } catch {
    return [];
  }
}
export function parseTheme(raw: string): Theme {
  try {
    const p = themeSchema.safeParse(JSON.parse(raw));
    return p.success ? p.data : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** wa.me link with the page's prefilled text. */
export const waLink = (theme: Theme, title: string) => (theme.whatsapp ? `https://wa.me/${theme.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(theme.whatsappText || `Hi! I saw your page “${title}”.`)}` : "");
