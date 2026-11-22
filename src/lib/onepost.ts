// OnePost — Content & PR Studio. Pure module (no DB, no Node APIs): shared by the server, the client UI and the tests.
import { z } from "zod";
import { checkTemplate } from "@/lib/template-check";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const POST_TYPES = [
  { key: "general", label: "General" },
  { key: "offer", label: "Offer" },
  { key: "event", label: "Event" },
  { key: "product_launch", label: "Product launch" },
  { key: "news", label: "News / announcement" },
] as const;
export type PostType = (typeof POST_TYPES)[number]["key"];
export const POST_TYPE_KEYS = POST_TYPES.map((t) => t.key) as [PostType, ...PostType[]];

export const LANGUAGES = [
  { key: "en", label: "English", prompt: "English" },
  { key: "hi", label: "Hindi", prompt: "Hindi written in Devanagari script" },
  { key: "pa", label: "Punjabi", prompt: "Punjabi written in Gurmukhi script" },
  { key: "hinglish", label: "Hinglish", prompt: "Hinglish: Hindi written in Roman letters, mixed naturally with English" },
] as const;
export type Language = (typeof LANGUAGES)[number]["key"];
export const LANGUAGE_KEYS = LANGUAGES.map((l) => l.key) as [Language, ...Language[]];

export const TONES = [
  { key: "friendly", label: "Friendly" },
  { key: "professional", label: "Professional" },
  { key: "festive", label: "Festive" },
  { key: "playful", label: "Playful" },
  { key: "urgent", label: "Urgent" },
  { key: "authoritative", label: "Authoritative" },
] as const;
export type Tone = (typeof TONES)[number]["key"];
export const TONE_KEYS = TONES.map((t) => t.key) as [Tone, ...Tone[]];

export const STATUSES = ["draft", "in_review", "changes_requested", "approved", "scheduled", "published", "failed"] as const;
export type PostStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<PostStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
};
export const STATUS_TONES: Record<PostStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  draft: "neutral",
  in_review: "info",
  changes_requested: "warning",
  approved: "success",
  scheduled: "info",
  published: "success",
  failed: "danger",
};
/** Statuses in which the content can still be edited. Later phases lock scheduled / published posts. */
export const EDITABLE_STATUSES: PostStatus[] = ["draft", "changes_requested", "in_review", "approved"];

export const CHANNELS = [
  { key: "blog", label: "Website blog", note: "SEO title, meta description, slug, headings and FAQ" },
  { key: "instagram", label: "Instagram", note: "Caption and hashtags" },
  { key: "facebook", label: "Facebook", note: "Page post" },
  { key: "linkedin", label: "LinkedIn", note: "Page post" },
  { key: "youtube", label: "YouTube", note: "Title, description, tags and Shorts caption" },
  { key: "gbp", label: "Google Business Profile", note: "Post under 1,500 characters with a call to action" },
  { key: "whatsapp", label: "WhatsApp broadcast", note: "Short message, written to template rules" },
  { key: "ads", label: "Ad copy", note: "Three variations" },
  { key: "press_release", label: "Press release", note: "Headline, dateline, body, boilerplate and media contact" },
  { key: "pitch_email", label: "Journalist pitch email", note: "Short email to accompany the press release" },
] as const;
export type Channel = (typeof CHANNELS)[number]["key"];
export const CHANNEL_KEYS = CHANNELS.map((c) => c.key) as [Channel, ...Channel[]];
export const CHANNEL_LABELS = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label])) as Record<Channel, string>;
export const isChannel = (v: unknown): v is Channel => typeof v === "string" && (CHANNEL_KEYS as string[]).includes(v);

export const GBP_CTAS = ["LEARN_MORE", "BOOK", "ORDER", "SHOP", "SIGN_UP", "CALL"] as const;
export const GBP_CTA_LABELS: Record<(typeof GBP_CTAS)[number], string> = { LEARN_MORE: "Learn more", BOOK: "Book", ORDER: "Order online", SHOP: "Buy", SIGN_UP: "Sign up", CALL: "Call now" };

export const MAX_MEDIA_PER_POST = 6;
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
export const MAX_LOGO_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Per-channel content (the JSON stored in OnePostVersion.content)
// ---------------------------------------------------------------------------

const str = (max: number) => z.string().trim().max(max);
const req = (max: number) => z.string().trim().min(1, "Required").max(max);

/** Hashtags are stored without "#" and without spaces or punctuation. */
export const cleanTag = (t: string) => t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 60);
export const cleanTags = (tags: string[], max: number) => [...new Set(tags.map(cleanTag).filter(Boolean))].slice(0, max);
const tagList = (max: number) => z.array(z.string().max(80)).max(max).transform((a) => cleanTags(a, max));

export const CONTENT_SCHEMAS = {
  blog: z.object({
    headline: req(140),
    seoTitle: req(80),
    metaDescription: req(200),
    slug: z.string().trim().min(1, "Required").max(90).regex(/^[a-z0-9ऀ-ॿ਀-੿]+(?:-[a-z0-9ऀ-ॿ਀-੿]+)*$/, "Use lowercase letters, numbers and dashes"),
    body: req(14000),
    faq: z.array(z.object({ q: req(250), a: req(1200) })).max(8),
  }),
  instagram: z.object({ caption: req(2200), hashtags: tagList(30) }),
  facebook: z.object({ text: req(5000), hashtags: tagList(10) }),
  linkedin: z.object({ text: req(3000), hashtags: tagList(8) }),
  youtube: z.object({ title: req(100), description: req(5000), tags: tagList(30), shortsCaption: str(150) }),
  gbp: z.object({ text: req(1500), cta: z.enum(GBP_CTAS), ctaUrl: str(300) }),
  whatsapp: z.object({ body: req(1024), suggestedCategory: z.enum(["MARKETING", "UTILITY"]) }),
  ads: z.object({ variations: z.array(z.object({ headline: req(80), primaryText: req(600), cta: req(30) })).min(1).max(3) }),
  press_release: z.object({
    headline: req(160),
    subheadline: str(220),
    dateline: req(120),
    body: req(8000),
    quoteText: str(700),
    quoteBy: str(140),
    boilerplate: str(1500),
    contactName: str(120),
    contactEmail: str(160),
    contactPhone: str(40),
  }),
  pitch_email: z.object({ subject: req(140), body: req(4000) }),
} satisfies Record<Channel, z.ZodType>;

export type ContentOf<C extends Channel> = z.infer<(typeof CONTENT_SCHEMAS)[C]>;
export type AnyContent = { [C in Channel]: ContentOf<C> }[Channel];

/** Validates and normalises content for a channel. Throws a ZodError for the caller to turn into a 400. */
export function parseContent<C extends Channel>(channel: C, raw: unknown): ContentOf<C> {
  return CONTENT_SCHEMAS[channel].parse(raw) as ContentOf<C>;
}

// ---------------------------------------------------------------------------
// Editor field specs (drives the edit dialog for every channel)
// ---------------------------------------------------------------------------

export type FieldSpec =
  | { key: string; label: string; kind: "text"; max: number; hint?: string }
  | { key: string; label: string; kind: "textarea"; max: number; rows?: number; hint?: string }
  | { key: string; label: string; kind: "tags"; max: number; hint?: string }
  | { key: string; label: string; kind: "select"; options: { value: string; label: string }[] }
  | { key: string; label: string; kind: "pairs"; maxItems: number; fields: { key: string; label: string; textarea?: boolean }[]; hint?: string };

const ctaOptions = GBP_CTAS.map((c) => ({ value: c, label: GBP_CTA_LABELS[c] }));

export const FIELD_SPECS: Record<Channel, FieldSpec[]> = {
  blog: [
    { key: "headline", label: "Headline (H1)", kind: "text", max: 140 },
    { key: "seoTitle", label: "SEO title", kind: "text", max: 80, hint: "Search results show about 60 characters" },
    { key: "metaDescription", label: "Meta description", kind: "textarea", max: 200, rows: 3, hint: "Aim for about 150–160 characters" },
    { key: "slug", label: "URL slug", kind: "text", max: 90 },
    { key: "body", label: "Article (Markdown, H2 headings with ##)", kind: "textarea", max: 14000, rows: 16 },
    { key: "faq", label: "FAQ", kind: "pairs", maxItems: 8, fields: [{ key: "q", label: "Question" }, { key: "a", label: "Answer", textarea: true }] },
  ],
  instagram: [
    { key: "caption", label: "Caption", kind: "textarea", max: 2200, rows: 8 },
    { key: "hashtags", label: "Hashtags", kind: "tags", max: 30, hint: "Up to 30, separated by spaces or commas" },
  ],
  facebook: [
    { key: "text", label: "Post", kind: "textarea", max: 5000, rows: 8 },
    { key: "hashtags", label: "Hashtags", kind: "tags", max: 10 },
  ],
  linkedin: [
    { key: "text", label: "Post", kind: "textarea", max: 3000, rows: 10 },
    { key: "hashtags", label: "Hashtags", kind: "tags", max: 8 },
  ],
  youtube: [
    { key: "title", label: "Title", kind: "text", max: 100 },
    { key: "description", label: "Description", kind: "textarea", max: 5000, rows: 10 },
    { key: "tags", label: "Tags", kind: "tags", max: 30, hint: "All tags together stay under 500 characters" },
    { key: "shortsCaption", label: "Shorts caption", kind: "text", max: 150 },
  ],
  gbp: [
    { key: "text", label: "Post", kind: "textarea", max: 1500, rows: 8 },
    { key: "cta", label: "Button", kind: "select", options: ctaOptions },
    { key: "ctaUrl", label: "Button link", kind: "text", max: 300, hint: "Not needed for Call now" },
  ],
  whatsapp: [
    { key: "body", label: "Message", kind: "textarea", max: 1024, rows: 6 },
    { key: "suggestedCategory", label: "Template category", kind: "select", options: [{ value: "MARKETING", label: "Marketing" }, { value: "UTILITY", label: "Utility" }] },
  ],
  ads: [{ key: "variations", label: "Variations", kind: "pairs", maxItems: 3, fields: [{ key: "headline", label: "Headline" }, { key: "primaryText", label: "Primary text", textarea: true }, { key: "cta", label: "Button" }] }],
  press_release: [
    { key: "headline", label: "Headline", kind: "text", max: 160 },
    { key: "subheadline", label: "Sub-headline", kind: "text", max: 220 },
    { key: "dateline", label: "Dateline", kind: "text", max: 120, hint: "For example: Shimla, India — 24 November 2026" },
    { key: "body", label: "Body", kind: "textarea", max: 8000, rows: 12 },
    { key: "quoteText", label: "Quote (only words your spokesperson actually said)", kind: "textarea", max: 700, rows: 3 },
    { key: "quoteBy", label: "Quote by (name and title)", kind: "text", max: 140 },
    { key: "boilerplate", label: "About the company", kind: "textarea", max: 1500, rows: 4 },
    { key: "contactName", label: "Media contact name", kind: "text", max: 120 },
    { key: "contactEmail", label: "Media contact email", kind: "text", max: 160 },
    { key: "contactPhone", label: "Media contact phone", kind: "text", max: 40 },
  ],
  pitch_email: [
    { key: "subject", label: "Subject", kind: "text", max: 140 },
    { key: "body", label: "Email", kind: "textarea", max: 4000, rows: 10 },
  ],
};

// ---------------------------------------------------------------------------
// Plain text (copy / download) for every channel
// ---------------------------------------------------------------------------

const hashLine = (tags: string[]) => tags.map((t) => `#${t}`).join(" ");

export function contentToText(channel: Channel, content: unknown): string {
  const c = content as Record<string, unknown>;
  switch (channel) {
    case "blog": {
      const b = c as ContentOf<"blog">;
      const faq = b.faq?.length ? `\n\n## FAQ\n\n${b.faq.map((f) => `**${f.q}**\n${f.a}`).join("\n\n")}` : "";
      return `# ${b.headline}\n\nSEO title: ${b.seoTitle}\nMeta description: ${b.metaDescription}\nSlug: ${b.slug}\n\n${b.body}${faq}`;
    }
    case "instagram": {
      const i = c as ContentOf<"instagram">;
      return [i.caption, hashLine(i.hashtags ?? [])].filter(Boolean).join("\n\n");
    }
    case "facebook": {
      const f = c as ContentOf<"facebook">;
      return [f.text, hashLine(f.hashtags ?? [])].filter(Boolean).join("\n\n");
    }
    case "linkedin": {
      const l = c as ContentOf<"linkedin">;
      return [l.text, hashLine(l.hashtags ?? [])].filter(Boolean).join("\n\n");
    }
    case "youtube": {
      const y = c as ContentOf<"youtube">;
      return `Title: ${y.title}\n\nDescription:\n${y.description}\n\nTags: ${(y.tags ?? []).join(", ")}${y.shortsCaption ? `\n\nShorts caption: ${y.shortsCaption}` : ""}`;
    }
    case "gbp": {
      const g = c as ContentOf<"gbp">;
      return `${g.text}\n\nButton: ${GBP_CTA_LABELS[g.cta] ?? g.cta}${g.ctaUrl ? ` — ${g.ctaUrl}` : ""}`;
    }
    case "whatsapp":
      return (c as ContentOf<"whatsapp">).body;
    case "ads":
      return (c as ContentOf<"ads">).variations.map((v, i) => `Variation ${i + 1}\nHeadline: ${v.headline}\nPrimary text: ${v.primaryText}\nButton: ${v.cta}`).join("\n\n");
    case "press_release": {
      const p = c as ContentOf<"press_release">;
      const quote = p.quoteText ? `\n\n“${p.quoteText}”${p.quoteBy ? ` — ${p.quoteBy}` : ""}` : "";
      const about = p.boilerplate ? `\n\nAbout:\n${p.boilerplate}` : "";
      const contact = [p.contactName, p.contactEmail, p.contactPhone].filter(Boolean).join(" · ");
      return `PRESS RELEASE\n\n${p.headline}${p.subheadline ? `\n${p.subheadline}` : ""}\n\n${p.dateline} — ${p.body}${quote}${about}${contact ? `\n\nMedia contact: ${contact}` : ""}\n\n###`;
    }
    case "pitch_email": {
      const e = c as ContentOf<"pitch_email">;
      return `Subject: ${e.subject}\n\n${e.body}`;
    }
  }
}

export const downloadExtension = (channel: Channel) => (channel === "blog" ? "md" : "txt");
export function downloadName(channel: Channel, title: string) {
  const base = slugify(title) || "post";
  return `${base}-${channel.replace("_", "-")}.${downloadExtension(channel)}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ऀ-ॿ਀-੿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// Checks: plain-language warnings shown on every version
// ---------------------------------------------------------------------------

export const wordCount = (s: string) => (s.trim().match(/\S+/g) ?? []).length;

const RISKY_CLAIMS = /\b(guaranteed?|100\s?%|risk[- ]free|number\s?(?:one|1)|#\s?1|best in (?:town|india|the world)|miracle|cure[sd]?|get rich)\b/i;
const PHONE_IN_TEXT = /(?:\+?\d[\s-]?){9,}/;

export type CheckContext = { quote?: string };

export function checkContent(channel: Channel, content: unknown, ctx: CheckContext = {}): string[] {
  const w: string[] = [];
  const text = contentToText(channel, content);
  if (RISKY_CLAIMS.test(text)) w.push("Contains a strong claim (for example “guaranteed”, “100%” or “best in town”). Remove it unless you can prove it.");
  const c = content as Record<string, unknown>;
  switch (channel) {
    case "blog": {
      const b = c as ContentOf<"blog">;
      const words = wordCount(b.body);
      if (words < 800 || words > 1200) w.push(`The article is ${words} words. A blog post usually works best at 800–1,200 words.`);
      if ((b.body.match(/^##\s/gm) ?? []).length < 3) w.push("Add at least three H2 headings (## Heading) so the article is easy to scan.");
      if (b.seoTitle.length > 60) w.push(`The SEO title is ${b.seoTitle.length} characters. Google usually shows about 60.`);
      if (b.metaDescription.length > 160) w.push(`The meta description is ${b.metaDescription.length} characters. Google usually shows about 160.`);
      if (!b.faq?.length) w.push("No FAQ yet. A short FAQ helps the post show up for questions people search.");
      break;
    }
    case "instagram": {
      const i = c as ContentOf<"instagram">;
      if ((i.hashtags ?? []).length < 3) w.push("Add a few more hashtags so more people can find the post.");
      if ((i.hashtags ?? []).length > 15) w.push("More than 15 hashtags looks spammy. 5–10 well-chosen tags work better.");
      break;
    }
    case "linkedin": {
      const l = c as ContentOf<"linkedin">;
      if ((l.hashtags ?? []).length > 5) w.push("LinkedIn posts do best with 3–5 hashtags.");
      break;
    }
    case "youtube": {
      const y = c as ContentOf<"youtube">;
      const tagChars = (y.tags ?? []).join(",").length;
      if (tagChars > 500) w.push(`Tags use ${tagChars} characters. YouTube allows 500 in total.`);
      if (y.title.length > 70) w.push("Titles over 70 characters get cut off in search results.");
      break;
    }
    case "gbp": {
      const g = c as ContentOf<"gbp">;
      if (PHONE_IN_TEXT.test(g.text)) w.push("Google Business Profile posts must not contain phone numbers in the text. Use the Call now button instead.");
      if (g.cta !== "CALL" && !g.ctaUrl) w.push("Add a link for the button, or choose Call now.");
      break;
    }
    case "whatsapp": {
      const m = c as ContentOf<"whatsapp">;
      const v = checkTemplate(m.body);
      w.push(...v.warnings, ...v.reasons);
      w.push("WhatsApp only lets you start a conversation with an approved template. Create this as a template and send it through Campaigns to customers who opted in.");
      break;
    }
    case "ads": {
      const a = c as ContentOf<"ads">;
      if (a.variations.length !== 3) w.push("Three variations are recommended so you can test them.");
      a.variations.forEach((v, i) => {
        if (v.headline.length > 40) w.push(`Variation ${i + 1}: the headline is ${v.headline.length} characters. Meta shows about 40.`);
        if (v.primaryText.length > 125) w.push(`Variation ${i + 1}: the primary text is ${v.primaryText.length} characters. Only the first 125 show before “See more”.`);
      });
      break;
    }
    case "press_release": {
      const p = c as ContentOf<"press_release">;
      if (!p.quoteText) w.push("No quote. Add words your spokesperson really said. MECGURA never makes up quotes.");
      else if (ctx.quote && p.quoteText.trim() !== ctx.quote.trim()) w.push("This quote differs from the one you gave. Use only words your spokesperson actually said.");
      if (!p.contactEmail && !p.contactPhone) w.push("Add a media contact email or phone so journalists can reach you.");
      if (wordCount(p.body) < 150) w.push("A press release usually runs 300–500 words. Add the key facts: what, who, when, where and why.");
      break;
    }
    case "pitch_email": {
      const e = c as ContentOf<"pitch_email">;
      if (wordCount(e.body) > 200) w.push("Journalists read short pitches. Aim for under 150 words.");
      break;
    }
    case "facebook":
      break;
  }
  return w;
}

// ---------------------------------------------------------------------------
// Different wording on every channel
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
function shingles(s: string, n = 4): Set<string> {
  const words = norm(s).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
  return out;
}

/** 0 (nothing in common) to 1 (identical): overlap of 4-word phrases. */
export function similarity(a: string, b: string): number {
  const A = shingles(a);
  const B = shingles(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const x of A) if (B.has(x)) both++;
  return both / Math.min(A.size, B.size);
}

export const DUPLICATE_THRESHOLD = 0.4;

/** Channels whose wording is too close to another channel's (so the same post isn't pasted everywhere). */
export function duplicateWarnings(versions: { channel: Channel; content: unknown }[]): Map<Channel, string[]> {
  const out = new Map<Channel, string[]>();
  const texts = versions.map((v) => ({ channel: v.channel, text: contentToText(v.channel, v.content) }));
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const s = similarity(texts[i].text, texts[j].text);
      if (s >= DUPLICATE_THRESHOLD) {
        const msg = (other: Channel) => `Wording is very close to the ${CHANNEL_LABELS[other]} version (${Math.round(s * 100)}% of phrases match). Rewrite it so each channel reads differently.`;
        out.set(texts[i].channel, [...(out.get(texts[i].channel) ?? []), msg(texts[j].channel)]);
        out.set(texts[j].channel, [...(out.get(texts[j].channel) ?? []), msg(texts[i].channel)]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Roles and the approval flow
// ---------------------------------------------------------------------------

export type FlowAction = "submit" | "approve" | "request_changes" | "reopen";
export const FLOW_ACTION_LABELS: Record<FlowAction, string> = { submit: "Send for review", approve: "Approve", request_changes: "Request changes", reopen: "Reopen for editing" };

/** Which status each action may start from. */
export const FLOW_FROM: Record<FlowAction, PostStatus[]> = {
  submit: ["draft", "changes_requested"],
  approve: ["draft", "in_review", "changes_requested"],
  request_changes: ["in_review"],
  reopen: ["in_review", "approved"],
};
export const FLOW_TO: Record<FlowAction, PostStatus> = { submit: "in_review", approve: "approved", request_changes: "changes_requested", reopen: "draft" };

export type OnePostRole = "CLIENT_OWNER" | "MANAGER" | "AGENT" | null; // null = platform Super Admin

export function flowActionsFor(status: PostStatus, role: OnePostRole): FlowAction[] {
  const isOwner = role === null || role === "CLIENT_OWNER";
  const canSubmit = isOwner || role === "MANAGER";
  const out: FlowAction[] = [];
  if (canSubmit && FLOW_FROM.submit.includes(status)) out.push("submit");
  if (isOwner && FLOW_FROM.approve.includes(status)) out.push("approve");
  if (isOwner && FLOW_FROM.request_changes.includes(status)) out.push("request_changes");
  if (canSubmit && FLOW_FROM.reopen.includes(status)) out.push("reopen");
  return out;
}
