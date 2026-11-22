import { CHANNEL_LABELS, GBP_CTAS, LANGUAGES, POST_TYPES, TONES, type Channel, type Language, type PostType, type Tone } from "@/lib/onepost";

export type BrandFacts = {
  businessName: string;
  services: string;
  city: string;
  website: string;
  about: string;
  tone: string;
  language: string;
  defaultHashtags: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

export type PostFacts = {
  title: string;
  brief: string;
  postType: PostType | string;
  language: Language | string;
  tone: Tone | string;
  city: string;
  keywords: string;
  spokespersonName: string;
  spokespersonQuote: string;
  videoUrl: string;
  hasMedia: boolean;
};

export type GenerateInput = {
  brand: BrandFacts;
  post: PostFacts;
  channel: Channel;
  /** Text from other channels this version must not repeat. */
  avoid?: string;
  /** A change the person asked for when regenerating this one version. */
  instruction?: string;
};

/** Each channel gets its own angle, so the same post is not pasted everywhere. */
const ANGLE: Record<Channel, string> = {
  blog: "an in-depth, helpful article that answers what a customer searching for this would want to know",
  instagram: "a short, emotional hook that makes people stop scrolling, then one clear action",
  facebook: "a warm, conversational note to the local community, with the key details",
  linkedin: "a professional insight or announcement written in the first person plural, with a business takeaway",
  youtube: "a clear description for people who found the video through search, with what they will learn",
  gbp: "a local, practical update for people searching nearby, with one clear action",
  whatsapp: "a short, personal message in a polite one-to-one voice",
  ads: "three different benefit-led angles, each with a different headline and hook",
  press_release: "a neutral, third-person news announcement in the style of an Indian press release",
  pitch_email: "a brief, respectful email to a journalist explaining why the story matters to their readers",
};

const SHAPE: Record<Channel, string> = {
  blog: `{"headline": string, "seoTitle": string (about 55-60 characters), "metaDescription": string (150-160 characters), "slug": string (lowercase words joined by dashes), "body": string (Markdown, 800-1200 words, 4-6 sections each starting with "## ", no H1), "faq": [{"q": string, "a": string}] (3-5 items)}`,
  instagram: `{"caption": string (under 900 characters, hook in the first line, 2-4 short lines, one call to action, at most 3 emojis, no hashtags inside), "hashtags": string[] (6-12, no # sign, no spaces)}`,
  facebook: `{"text": string (under 900 characters, one call to action, at most 3 emojis), "hashtags": string[] (0-5, no # sign)}`,
  linkedin: `{"text": string (under 1800 characters, short paragraphs, no emoji spam), "hashtags": string[] (3-5, no # sign)}`,
  youtube: `{"title": string (under 70 characters), "description": string (first 2 lines carry the main message and keywords; 150-300 words; end with a call to action), "tags": string[] (8-15 single or short phrases), "shortsCaption": string (under 100 characters, may end with 2-3 hashtags)}`,
  gbp: `{"text": string (UNDER 1400 characters, no phone numbers, no links inside the text, ends with a clear action), "cta": one of ${GBP_CTAS.map((c) => `"${c}"`).join(", ")}, "ctaUrl": string (the website from the brand profile or an empty string)}`,
  whatsapp: `{"body": string (under 600 characters, plain and polite, may use {{1}} for the customer's first name only, include a way to opt out such as "Reply STOP to opt out" when it is a promotion), "suggestedCategory": "MARKETING" or "UTILITY"}`,
  ads: `{"variations": [{"headline": string (under 40 characters), "primaryText": string (under 125 characters), "cta": string (a short button label such as "Learn more", "Send message", "Book now")}] (exactly 3, each with a clearly different angle and wording)}`,
  press_release: `{"headline": string, "subheadline": string, "dateline": string ("CITY, India — date" using the city from the facts and today's date), "body": string (300-450 words in third person, paragraphs separated by blank lines; who, what, when, where, why), "quoteText": string, "quoteBy": string, "boilerplate": string (the company description from the brand profile, rewritten only for clarity), "contactName": string, "contactEmail": string, "contactPhone": string}`,
  pitch_email: `{"subject": string (under 80 characters), "body": string (under 150 words; greeting with "Dear [Name]" is not allowed because the name is added later, so start with "Hello,"; what the story is, why their readers care, what you can offer such as an interview or photos, and a polite close)}`,
};

const label = (arr: readonly { key: string; label?: string; prompt?: string }[], key: string) => arr.find((a) => a.key === key);

export function buildPrompt(input: GenerateInput): { system: string; user: string } {
  const { brand, post, channel } = input;
  const lang = label(LANGUAGES, post.language)?.prompt ?? "English";
  const tone = label(TONES, post.tone)?.label ?? post.tone;
  const type = label(POST_TYPES, post.postType)?.label ?? "General";
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

  const system = [
    `You are a senior content and PR writer for small businesses in India. You write ONE version of a post: the ${CHANNEL_LABELS[channel]}.`,
    `Angle for this channel: ${ANGLE[channel]}.`,
    `Write in ${lang}. Tone: ${tone}. Today is ${today}.`,
    "Hard rules:",
    "- Use only facts from the brand profile and the post details. Never invent prices, discounts, dates, awards, statistics, customer names, reviews or quotes. If a detail is missing, leave it out instead of guessing.",
    "- No misleading, exaggerated or unprovable claims (for example “best in town”, “guaranteed”, “100%”).",
    "- Write original wording for this channel. Do not copy sentences that would also fit another channel.",
    channel === "press_release"
      ? "- This is a PRESS RELEASE, not a news article. Never write it as if a newspaper or TV channel wrote it, and never invent quotes. Put the spokesperson quote into quoteText exactly as supplied (character for character) and the spokesperson into quoteBy; if no quote is supplied, return empty strings for both."
      : "",
    channel === "whatsapp" ? "- WhatsApp rules: this is a business-initiated message, so it must read as a polite, relevant message to someone who opted in. No misleading urgency, no ALL CAPS, no more than one emoji." : "",
    `Return ONLY one JSON object, with no Markdown fences and no commentary, in exactly this shape:\n${SHAPE[channel]}`,
  ]
    .filter(Boolean)
    .join("\n");

  const facts = [
    `Business: ${brand.businessName || "(not set)"}`,
    brand.services ? `Services: ${brand.services}` : "",
    brand.city ? `Business city: ${brand.city}` : "",
    brand.website ? `Website: ${brand.website}` : "",
    brand.about ? `About the business: ${brand.about}` : "",
    brand.contactName || brand.contactEmail || brand.contactPhone ? `Media contact: ${[brand.contactName, brand.contactEmail, brand.contactPhone].filter(Boolean).join(", ")}` : "",
    brand.defaultHashtags ? `Brand hashtags to include where they fit: ${brand.defaultHashtags}` : "",
    "",
    `Post type: ${type}`,
    `Title / idea: ${post.title}`,
    post.brief ? `Details:\n${post.brief}` : "",
    post.city ? `Target city: ${post.city}` : "",
    post.keywords ? `Keywords to use naturally: ${post.keywords}` : "",
    post.spokespersonName ? `Spokesperson: ${post.spokespersonName}` : "",
    post.spokespersonQuote ? `Spokesperson quote (use exactly as given): ${post.spokespersonQuote}` : "",
    post.videoUrl ? `Video link: ${post.videoUrl}` : "",
    post.hasMedia ? "The post comes with photos or a video." : "",
    input.instruction ? `\nThe client asked for this change: ${input.instruction}` : "",
    input.avoid ? `\nDo not reuse wording from these other versions. Use clearly different sentences and structure:\n${input.avoid}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { system, user: facts };
}
