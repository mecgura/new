"use client";

import * as React from "react";
import { Bookmark, Globe, Heart, Image as ImageIcon, MessageCircle, MoreHorizontal, Play, Send, ThumbsUp, Share2, Repeat2 } from "lucide-react";
import { GBP_CTA_LABELS, type Channel, type ContentOf } from "@/lib/onepost";

export type PreviewBrand = { businessName: string; logoUrl: string | null; website: string };
type P<C extends Channel> = { content: ContentOf<C>; brand: PreviewBrand; images: string[] };

/** Realistic, read-only previews. They sit on light "device" surfaces, the way each platform really looks. */
const surface = "rounded-xl border border-black/10 bg-white text-neutral-900 shadow-sm";

function Avatar({ brand, size = 36 }: { brand: PreviewBrand; size?: number }) {
  const initial = (brand.businessName.trim()[0] ?? "B").toUpperCase();
  return brand.logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={brand.logoUrl} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white" style={{ width: size, height: size }}>
      {initial}
    </span>
  );
}

function Media({ images, ratio, className = "" }: { images: string[]; ratio: string; className?: string }) {
  return images[0] ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={images[0]} alt="" className={`w-full object-cover ${className}`} style={{ aspectRatio: ratio }} />
  ) : (
    <div className={`flex w-full items-center justify-center bg-neutral-100 text-neutral-400 ${className}`} style={{ aspectRatio: ratio }}>
      <ImageIcon className="size-8" aria-hidden="true" />
    </div>
  );
}

const clamp = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const Tags = ({ tags }: { tags: string[] }) => (tags.length ? <p className="mt-1 break-words text-sky-700">{tags.map((t) => `#${t}`).join(" ")}</p> : null);

export function InstagramPreview({ content: c, brand, images }: P<"instagram">) {
  return (
    <div className={`${surface} overflow-hidden text-[13px]`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Avatar brand={brand} size={32} />
        <span className="flex-1 truncate font-semibold">{brand.businessName || "yourbusiness"}</span>
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </div>
      <Media images={images} ratio="1 / 1" />
      <div className="flex items-center gap-3 px-3 pt-2.5">
        <Heart className="size-5" aria-hidden="true" />
        <MessageCircle className="size-5" aria-hidden="true" />
        <Send className="size-5" aria-hidden="true" />
        <Bookmark className="ml-auto size-5" aria-hidden="true" />
      </div>
      <div className="px-3 pb-3 pt-2 leading-snug">
        <p className="whitespace-pre-line break-words">
          <span className="font-semibold">{brand.businessName || "yourbusiness"}</span> {clamp(c.caption, 140)}
          {c.caption.length > 140 ? <span className="text-neutral-500"> more</span> : null}
        </p>
        <Tags tags={c.hashtags} />
      </div>
    </div>
  );
}

export function FacebookPreview({ content: c, brand, images }: P<"facebook">) {
  return (
    <div className={`${surface} overflow-hidden text-[13px]`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Avatar brand={brand} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{brand.businessName || "Your Page"}</p>
          <p className="flex items-center gap-1 text-xs text-neutral-500">
            Just now · <Globe className="size-3" aria-hidden="true" />
          </p>
        </div>
      </div>
      <p className="whitespace-pre-line break-words px-3 pb-2 leading-snug">{clamp(c.text, 500)}</p>
      {c.hashtags.length ? <div className="px-3 pb-2"><Tags tags={c.hashtags} /></div> : null}
      {images[0] ? <Media images={images} ratio="1.91 / 1" /> : null}
      <div className="flex justify-around border-t border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-600">
        <span className="flex items-center gap-1"><ThumbsUp className="size-4" aria-hidden="true" /> Like</span>
        <span className="flex items-center gap-1"><MessageCircle className="size-4" aria-hidden="true" /> Comment</span>
        <span className="flex items-center gap-1"><Share2 className="size-4" aria-hidden="true" /> Share</span>
      </div>
    </div>
  );
}

export function LinkedInPreview({ content: c, brand, images }: P<"linkedin">) {
  return (
    <div className={`${surface} overflow-hidden text-[13px]`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Avatar brand={brand} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{brand.businessName || "Your Company"}</p>
          <p className="text-xs text-neutral-500">Company page · Now</p>
        </div>
      </div>
      <p className="whitespace-pre-line break-words px-3 pb-2 leading-snug">{clamp(c.text, 600)}{c.text.length > 600 ? <span className="text-neutral-500"> …see more</span> : null}</p>
      {c.hashtags.length ? <div className="px-3 pb-2"><Tags tags={c.hashtags} /></div> : null}
      {images[0] ? <Media images={images} ratio="1.91 / 1" /> : null}
      <div className="flex justify-around border-t border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-600">
        <span className="flex items-center gap-1"><ThumbsUp className="size-4" aria-hidden="true" /> Like</span>
        <span className="flex items-center gap-1"><MessageCircle className="size-4" aria-hidden="true" /> Comment</span>
        <span className="flex items-center gap-1"><Repeat2 className="size-4" aria-hidden="true" /> Repost</span>
        <span className="flex items-center gap-1"><Send className="size-4" aria-hidden="true" /> Send</span>
      </div>
    </div>
  );
}

export function YouTubePreview({ content: c, brand, images }: P<"youtube">) {
  return (
    <div className={`${surface} overflow-hidden text-[13px]`}>
      <div className="relative">
        <Media images={images} ratio="16 / 9" />
        <span className="absolute inset-0 flex items-center justify-center"><span className="flex size-11 items-center justify-center rounded-full bg-black/70 text-white"><Play className="size-5" aria-hidden="true" /></span></span>
      </div>
      <div className="flex gap-2 px-3 py-2.5">
        <Avatar brand={brand} size={32} />
        <div className="min-w-0">
          <p className="line-clamp-2 font-semibold leading-snug">{c.title}</p>
          <p className="text-xs text-neutral-500">{brand.businessName || "Your channel"} · 0 views · Just now</p>
        </div>
      </div>
      <div className="mx-3 mb-3 rounded-lg bg-neutral-100 p-2.5 text-xs leading-snug">
        <p className="line-clamp-4 whitespace-pre-line break-words">{c.description}</p>
        {c.tags.length ? <p className="mt-1.5 break-words text-neutral-500">{c.tags.slice(0, 8).join(" · ")}</p> : null}
      </div>
      {c.shortsCaption ? (
        <div className="mx-3 mb-3 rounded-lg border border-neutral-200 p-2 text-xs">
          <span className="font-semibold">Shorts caption: </span>
          {c.shortsCaption}
        </div>
      ) : null}
    </div>
  );
}

export function GbpPreview({ content: c, brand, images }: P<"gbp">) {
  return (
    <div className={`${surface} overflow-hidden text-[13px]`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Avatar brand={brand} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{brand.businessName || "Your business"}</p>
          <p className="text-xs text-neutral-500">Update · Just now</p>
        </div>
      </div>
      {images[0] ? <Media images={images} ratio="4 / 3" /> : null}
      <p className="whitespace-pre-line break-words px-3 py-2.5 leading-snug">{c.text}</p>
      <div className="px-3 pb-3">
        <span className="inline-block rounded-full border border-sky-700 px-4 py-1.5 text-xs font-semibold text-sky-700">{GBP_CTA_LABELS[c.cta] ?? c.cta}</span>
        <span className="ml-2 text-xs text-neutral-400">{c.text.length}/1500</span>
      </div>
    </div>
  );
}

export function WhatsAppPreview({ content: c, brand }: P<"whatsapp">) {
  return (
    <div className="overflow-hidden rounded-xl border border-black/10 text-[13px] shadow-sm">
      <div className="flex items-center gap-2 bg-[#075e54] px-3 py-2 text-white">
        <Avatar brand={brand} size={28} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{brand.businessName || "Your business"}</p>
          <p className="text-[11px] opacity-80">Business account</p>
        </div>
      </div>
      <div className="bg-[#ece5dd] p-3">
        <div className="ml-0 max-w-[92%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-neutral-900 shadow-sm">
          <p className="whitespace-pre-line break-words leading-snug">{c.body}</p>
          <p className="mt-1 text-right text-[10px] text-neutral-500">10:30</p>
        </div>
        <p className="mt-2 text-center text-[11px] text-neutral-600">Sent as a {c.suggestedCategory === "UTILITY" ? "utility" : "marketing"} template</p>
      </div>
    </div>
  );
}

export function AdsPreview({ content: c, brand, images }: P<"ads">) {
  return (
    <div className="space-y-3">
      {c.variations.map((v, i) => (
        <div key={i} className={`${surface} overflow-hidden text-[13px]`}>
          <div className="flex items-center gap-2 px-3 py-2">
            <Avatar brand={brand} size={28} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{brand.businessName || "Your business"}</p>
              <p className="text-[11px] text-neutral-500">Sponsored · Variation {i + 1}</p>
            </div>
          </div>
          <p className="px-3 pb-2 leading-snug">{v.primaryText}</p>
          <Media images={images} ratio="1.91 / 1" />
          <div className="flex items-center justify-between gap-2 bg-neutral-100 px-3 py-2">
            <p className="min-w-0 truncate font-semibold">{v.headline}</p>
            <span className="shrink-0 rounded bg-neutral-300 px-2 py-1 text-xs font-semibold">{v.cta}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Headings, paragraphs and bullet lists only. Anything else is shown as plain text, never as HTML. */
function MiniMarkdown({ text, max = 2400 }: { text: string; max?: number }) {
  const blocks = text.slice(0, max).split(/\n{2,}/);
  return (
    <div className="space-y-2 leading-snug">
      {blocks.map((b, i) => {
        const t = b.trim();
        if (/^##\s/.test(t)) return <h4 key={i} className="pt-1 text-sm font-bold">{t.replace(/^##\s+/, "")}</h4>;
        if (/^[-*]\s/.test(t)) return <ul key={i} className="list-disc pl-5">{t.split("\n").map((l, j) => <li key={j}>{l.replace(/^[-*]\s+/, "")}</li>)}</ul>;
        return <p key={i} className="whitespace-pre-line break-words">{t}</p>;
      })}
      {text.length > max ? <p className="text-neutral-400">…</p> : null}
    </div>
  );
}

export function BlogPreview({ content: c, brand }: P<"blog">) {
  const host = (brand.website || "yourwebsite.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <div className={`${surface} overflow-hidden text-[13px]`}>
      <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-2.5">
        <p className="truncate text-xs text-neutral-600">{host} › blog › {c.slug}</p>
        <p className="mt-0.5 line-clamp-2 text-[15px] font-medium leading-snug text-blue-800">{c.seoTitle}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-neutral-600">{c.metaDescription}</p>
      </div>
      <div className="max-h-80 overflow-y-auto px-3 py-3">
        <h3 className="mb-2 text-base font-bold leading-snug">{c.headline}</h3>
        <MiniMarkdown text={c.body} />
        {c.faq.length ? (
          <div className="mt-3 border-t border-neutral-200 pt-2">
            <h4 className="text-sm font-bold">FAQ</h4>
            {c.faq.map((f, i) => (
              <p key={i} className="mt-1.5"><span className="font-semibold">{f.q}</span> {f.a}</p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function PressReleasePreview({ content: c }: P<"press_release">) {
  return (
    <div className={`${surface} px-4 py-3 font-serif text-[13px] leading-snug`}>
      <p className="font-sans text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">Press release</p>
      <h3 className="mt-1.5 text-base font-bold leading-snug">{c.headline}</h3>
      {c.subheadline ? <p className="mt-0.5 italic text-neutral-600">{c.subheadline}</p> : null}
      <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
        <p className="whitespace-pre-line break-words"><span className="font-bold">{c.dateline} —</span> {c.body}</p>
        {c.quoteText ? <blockquote className="border-l-2 border-neutral-300 pl-3 italic">“{c.quoteText}”{c.quoteBy ? <span className="not-italic"> — {c.quoteBy}</span> : null}</blockquote> : null}
        {c.boilerplate ? <p className="text-xs text-neutral-600"><span className="font-bold">About: </span>{c.boilerplate}</p> : null}
      </div>
      {c.contactName || c.contactEmail || c.contactPhone ? <p className="mt-2 border-t border-neutral-200 pt-2 text-xs"><span className="font-bold">Media contact: </span>{[c.contactName, c.contactEmail, c.contactPhone].filter(Boolean).join(" · ")}</p> : null}
      <p className="mt-1 text-center text-xs tracking-widest text-neutral-400">###</p>
    </div>
  );
}

export function PitchEmailPreview({ content: c, brand }: P<"pitch_email">) {
  return (
    <div className={`${surface} overflow-hidden text-[13px]`}>
      <div className="space-y-0.5 border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
        <p><span className="text-neutral-500">From:</span> {brand.businessName || "Your business"}</p>
        <p><span className="text-neutral-500">To:</span> Journalist (you choose in a later step)</p>
        <p className="font-semibold"><span className="font-normal text-neutral-500">Subject:</span> {c.subject}</p>
      </div>
      <p className="max-h-60 overflow-y-auto whitespace-pre-line break-words px-3 py-3 leading-snug">{c.body}</p>
    </div>
  );
}

export function ChannelPreview({ channel, content, brand, images }: { channel: Channel; content: unknown; brand: PreviewBrand; images: string[] }) {
  const p = { brand, images };
  switch (channel) {
    case "blog": return <BlogPreview content={content as ContentOf<"blog">} {...p} />;
    case "instagram": return <InstagramPreview content={content as ContentOf<"instagram">} {...p} />;
    case "facebook": return <FacebookPreview content={content as ContentOf<"facebook">} {...p} />;
    case "linkedin": return <LinkedInPreview content={content as ContentOf<"linkedin">} {...p} />;
    case "youtube": return <YouTubePreview content={content as ContentOf<"youtube">} {...p} />;
    case "gbp": return <GbpPreview content={content as ContentOf<"gbp">} {...p} />;
    case "whatsapp": return <WhatsAppPreview content={content as ContentOf<"whatsapp">} {...p} />;
    case "ads": return <AdsPreview content={content as ContentOf<"ads">} {...p} />;
    case "press_release": return <PressReleasePreview content={content as ContentOf<"press_release">} {...p} />;
    case "pitch_email": return <PitchEmailPreview content={content as ContentOf<"pitch_email">} {...p} />;
  }
}
