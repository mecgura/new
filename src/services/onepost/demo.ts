import { cleanTags, slugify, GBP_CTAS } from "@/lib/onepost";
import type { GenerateInput } from "@/services/onepost/prompts";

/**
 * Offline drafts used when no AI key is configured (ANTHROPIC_API_KEY / OPENAI_API_KEY). They only rearrange the facts the client
 * typed — nothing is invented — and every version is labelled "demo" so nobody mistakes them for finished copy.
 */
const first = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…`);

export function demoContent(input: GenerateInput): unknown {
  const { brand, post, channel } = input;
  const name = brand.businessName || "our business";
  const city = post.city || brand.city;
  const where = city ? ` in ${city}` : "";
  const title = post.title.trim();
  const details = post.brief.trim() || title;
  const kw = post.keywords.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
  const tags = cleanTags([...brand.defaultHashtags.split(/[\s,]+/), ...kw, name.replace(/\s+/g, ""), city, brand.services.split(/[,\n]/)[0] ?? ""], 12);
  const site = brand.website;

  switch (channel) {
    case "blog":
      return {
        headline: title,
        seoTitle: first(`${title} | ${name}`, 60),
        metaDescription: first(`${details} Read more from ${name}${where}.`, 158),
        slug: slugify(title) || "update",
        body: [
          `## What is new at ${name}`,
          details,
          `## Why it matters${where}`,
          `${name} shares this update so customers${where} know what to expect and how to get in touch.`,
          kw.length ? `## Topics covered\n${kw.map((k) => `- ${k}`).join("\n")}` : `## Good to know\nAsk the ${name} team if you would like more information.`,
          `## How to get in touch`,
          `${site ? `Visit ${site} or ` : ""}contact ${name}${brand.contactPhone ? ` on ${brand.contactPhone}` : ""} for details.`,
        ].join("\n\n"),
        faq: [
          { q: `Who is this for?`, a: `Anyone${where} who is interested in ${title.toLowerCase()}.` },
          { q: `How do I find out more?`, a: `Contact ${name}${site ? ` through ${site}` : ""}.` },
        ],
      };
    case "instagram":
      return { caption: `${title}\n\n${first(details, 220)}\n\nMessage ${name} to know more.`, hashtags: tags };
    case "facebook":
      return { text: `Hello${city ? ` ${city}` : ""}! ${name} has news: ${title}.\n\n${first(details, 500)}\n\nDrop us a message if you have questions.`, hashtags: tags.slice(0, 3) };
    case "linkedin":
      return { text: `We are pleased to share an update from ${name}: ${title}.\n\n${first(details, 700)}\n\nWe would be glad to hear how this fits your plans.`, hashtags: tags.slice(0, 4) };
    case "youtube":
      return {
        title: first(`${title} | ${name}`, 70),
        description: `${first(details, 400)}\n\nWatch to see the details from ${name}${where}.\n${site ? `\nMore: ${site}\n` : ""}\nSubscribe for more updates from ${name}.`,
        tags: cleanTags([name, title, ...kw, city], 15),
        shortsCaption: first(`${title} — ${name}`, 90),
      };
    case "gbp":
      return { text: first(`${name}${where}: ${title}. ${details}`, 1400), cta: GBP_CTAS[0], ctaUrl: site };
    case "whatsapp":
      return { body: first(`Hi {{1}}, ${name} here. ${title}. ${first(details, 260)} Reply STOP to opt out.`, 600), suggestedCategory: "MARKETING" };
    case "ads":
      return {
        variations: [
          { headline: first(title, 40), primaryText: first(details, 120), cta: "Learn more" },
          { headline: first(`${name}${where}`, 40), primaryText: first(`New from ${name}: ${title}`, 120), cta: "Send message" },
          { headline: first(`Ask us about ${title}`, 40), primaryText: first(`Questions? ${name} is happy to help${where}.`, 120), cta: "Contact us" },
        ],
      };
    case "press_release":
      return {
        headline: title,
        subheadline: first(details, 200),
        dateline: `${city || "India"}, India — ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}`,
        body: `${name}${where} today announced ${title.toLowerCase()}.\n\n${details}\n\nFor more information, please contact the media contact below.`,
        quoteText: post.spokespersonQuote.trim(),
        quoteBy: post.spokespersonQuote.trim() ? post.spokespersonName.trim() : "",
        boilerplate: brand.about,
        contactName: brand.contactName,
        contactEmail: brand.contactEmail,
        contactPhone: brand.contactPhone,
      };
    case "pitch_email":
      return {
        subject: first(`Story idea: ${title}`, 80),
        body: `Hello,\n\n${name}${where} has news that may interest your readers: ${title}. ${first(details, 300)}\n\nI can share the press release, photos and a spokesperson for a quick conversation, whenever it suits you.\n\nThank you for your time.\n${brand.contactName || name}${brand.contactEmail ? `\n${brand.contactEmail}` : ""}${brand.contactPhone ? `\n${brand.contactPhone}` : ""}`,
      };
  }
}
