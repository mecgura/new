import * as React from "react";
import { ACCENTS, waLink, youtubeId, type Block, type Theme } from "@/lib/landing";
import { LeadForm, TrackedLink } from "./interactive";

/**
 * Renders a landing page from its blocks. Used by the public page and by the builder's live preview, so what the
 * client designs is exactly what visitors see. Light, simple layout that reads well on phones.
 */
export function PageView({ pageId, title, business, blocks, theme, qrDataUrl, preview, selectedId, onSelect }: { pageId: string | null; title: string; business: string; blocks: Block[]; theme: Theme; qrDataUrl?: string; preview?: boolean; selectedId?: string | null; onSelect?: (id: string) => void }) {
  const a = ACCENTS[theme.accent];
  const wa = waLink(theme, title);
  const firstForm = blocks.find((b) => b.type === "form");
  const target = (action: "whatsapp" | "form" | "link", link?: string) => (action === "whatsapp" ? wa : action === "form" ? (firstForm ? `#form-${firstForm.id}` : wa) : link || wa);
  const btn = "inline-flex h-12 items-center justify-center rounded-xl px-6 text-base font-semibold shadow-sm transition-transform hover:-translate-y-0.5";
  const H2 = ({ children }: { children: React.ReactNode }) => (children ? <h2 className="mb-5 text-center text-2xl font-bold tracking-tight text-[#14211b] @2xl:text-3xl">{children}</h2> : null);

  const render = (b: Block) => {
    switch (b.type) {
      case "hero":
        return (
          <section className="px-5 pb-12 pt-14 @2xl:pt-20" style={{ background: a.soft }}>
            <div className="mx-auto grid max-w-5xl items-center gap-8 @3xl:grid-cols-2">
              <div className={b.imageUrl ? "" : "@3xl:col-span-2 @3xl:text-center"}>
                <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: a.bg }}>{business}</p>
                <h1 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-[#14211b] @2xl:text-5xl">{b.heading}</h1>
                {b.subheading ? <p className="mt-4 text-lg leading-relaxed text-[#45584d]">{b.subheading}</p> : null}
                {b.buttonLabel ? (
                  <div className="mt-7"><TrackedLink pageId={pageId} preview={preview} name="hero" href={target(b.action, b.link)} className={btn} style={{ background: a.bg, color: a.text }}>{b.buttonLabel}</TrackedLink></div>
                ) : null}
              </div>
              {b.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.imageUrl} alt="" className="aspect-[4/3] w-full rounded-3xl object-cover shadow-lg" />
              ) : null}
            </div>
          </section>
        );
      case "text":
        return (
          <section className="px-5 py-12">
            <div className="mx-auto max-w-3xl">
              <H2>{b.heading}</H2>
              <p className="whitespace-pre-line text-center text-[17px] leading-relaxed text-[#45584d]">{b.body}</p>
            </div>
          </section>
        );
      case "features":
      case "services":
        return (
          <section className="px-5 py-12">
            <div className="mx-auto max-w-5xl">
              <H2>{b.heading}</H2>
              <div className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
                {b.items.map((it, i) => (
                  <div key={i} className="rounded-2xl border border-black/10 bg-white p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-lg font-semibold text-[#14211b]">{it.title}</h3>
                      {"price" in it && it.price ? <span className="shrink-0 font-semibold" style={{ color: a.bg }}>{it.price}</span> : null}
                    </div>
                    {it.text ? <p className="mt-1.5 text-[15px] text-[#45584d]">{it.text}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      case "pricing":
        return (
          <section className="px-5 py-12" style={{ background: a.soft }}>
            <div className="mx-auto max-w-5xl">
              <H2>{b.heading}</H2>
              <div className="grid gap-4 @3xl:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
                {b.plans.map((p, i) => (
                  <div key={i} className="flex flex-col rounded-2xl border bg-white p-6" style={{ borderColor: p.highlight ? a.ring : "rgba(0,0,0,.1)", boxShadow: p.highlight ? `0 0 0 2px ${a.ring}` : undefined }}>
                    {p.highlight ? <span className="mb-2 self-start rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: a.soft, color: a.bg }}>Most popular</span> : null}
                    <h3 className="text-lg font-semibold text-[#14211b]">{p.name}</h3>
                    <p className="mt-2 text-3xl font-extrabold text-[#14211b]">{p.price}<span className="text-base font-medium text-[#45584d]">{p.period}</span></p>
                    <ul className="mt-4 flex-1 space-y-2 text-[15px] text-[#45584d]">{p.features.map((f, j) => <li key={j}>✓ {f}</li>)}</ul>
                    {b.buttonLabel ? <TrackedLink pageId={pageId} preview={preview} name="pricing" href={target(b.action === "link" ? "whatsapp" : b.action)} className={`${btn} mt-6 w-full`} style={{ background: p.highlight ? a.bg : "#14211b", color: "#fff" }}>{b.buttonLabel}</TrackedLink> : null}
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      case "image":
        return b.url ? (
          <figure className="mx-auto max-w-4xl px-5 py-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.url} alt={b.alt} className="w-full rounded-3xl object-cover" />
            {b.caption ? <figcaption className="mt-2 text-center text-sm text-[#45584d]">{b.caption}</figcaption> : null}
          </figure>
        ) : preview ? <p className="px-5 py-8 text-center text-sm text-[#7b8a80]">Add an image</p> : null;
      case "video": {
        const vid = youtubeId(b.youtubeUrl);
        return vid ? (
          <section className="px-5 py-12">
            <div className="mx-auto max-w-4xl">
              <H2>{b.heading}</H2>
              <div className="aspect-video overflow-hidden rounded-3xl bg-black">
                <iframe className="size-full" src={`https://www.youtube-nocookie.com/embed/${vid}`} title={b.heading || "Video"} loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              </div>
            </div>
          </section>
        ) : preview ? <p className="px-5 py-8 text-center text-sm text-[#7b8a80]">Paste a YouTube link</p> : null;
      }
      case "testimonials":
        return b.items.length ? (
          <section className="px-5 py-12">
            <div className="mx-auto max-w-5xl">
              <H2>{b.heading}</H2>
              <div className="grid gap-4 @3xl:grid-cols-3">
                {b.items.map((t, i) => (
                  <blockquote key={i} className="rounded-2xl border border-black/10 bg-white p-5 text-[15px] text-[#14211b]">
                    “{t.quote}”<footer className="mt-3 text-sm font-semibold" style={{ color: a.bg }}>{t.name}</footer>
                  </blockquote>
                ))}
              </div>
            </div>
          </section>
        ) : preview ? <p className="px-5 py-8 text-center text-sm text-[#7b8a80]">Add real quotes from your customers (with their permission)</p> : null;
      case "faq":
        return (
          <section className="px-5 py-12">
            <div className="mx-auto max-w-3xl">
              <H2>{b.heading}</H2>
              <div className="divide-y divide-black/10 rounded-2xl border border-black/10 bg-white">
                {b.items.map((f, i) => (
                  <details key={i} className="group p-4">
                    <summary className="cursor-pointer list-none font-semibold text-[#14211b]">{f.q}</summary>
                    {f.a ? <p className="mt-2 text-[15px] text-[#45584d]">{f.a}</p> : null}
                  </details>
                ))}
              </div>
            </div>
          </section>
        );
      case "form":
        return (
          <section id={`form-${b.id}`} className="scroll-mt-6 px-5 py-12" style={{ background: a.soft }}>
            <div className="mx-auto max-w-lg">
              <H2>{b.heading}</H2>
              {b.text ? <p className="-mt-3 mb-5 text-center text-[15px] text-[#45584d]">{b.text}</p> : null}
              <LeadForm pageId={pageId} form={b} accent={a.bg} preview={preview} />
            </div>
          </section>
        );
      case "cta":
        return (
          <section className="px-5 py-14 text-center" style={{ background: a.bg, color: a.text }}>
            <h2 className="text-2xl font-bold @2xl:text-3xl">{b.heading}</h2>
            {b.text ? <p className="mx-auto mt-2 max-w-xl opacity-90">{b.text}</p> : null}
            {b.buttonLabel ? <TrackedLink pageId={pageId} preview={preview} name="cta" href={target(b.action, b.link)} className={`${btn} mt-6 bg-white`} style={{ color: a.bg }}>{b.buttonLabel}</TrackedLink> : null}
          </section>
        );
      case "qr":
        return (
          <section className="px-5 py-12 text-center">
            <H2>{b.heading}</H2>
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt={`QR code for ${title}`} width={200} height={200} className="mx-auto rounded-xl border border-black/10 bg-white p-2" />
            ) : <div className="mx-auto flex size-[200px] items-center justify-center rounded-xl border border-dashed border-black/20 text-sm text-[#7b8a80]">QR appears when published</div>}
            {b.text ? <p className="mt-3 text-[15px] text-[#45584d]">{b.text}</p> : null}
          </section>
        );
      case "contact":
        return (
          <section className="px-5 py-12">
            <div className="mx-auto max-w-3xl rounded-2xl border border-black/10 bg-white p-6 text-center">
              <H2>{b.heading}</H2>
              {b.address ? <p className="whitespace-pre-line text-[#14211b]">{b.address}</p> : null}
              {b.timings ? <p className="mt-2 whitespace-pre-line text-[#45584d]">{b.timings}</p> : null}
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                {b.mapsUrl ? <TrackedLink pageId={pageId} preview={preview} name="maps" href={b.mapsUrl} className={`${btn} border border-black/15 bg-white text-[#14211b]`}>Get directions</TrackedLink> : null}
                {b.phone ? <TrackedLink pageId={pageId} preview={preview} name="call" href={`tel:${b.phone.replace(/[^\d+]/g, "")}`} className={`${btn} border border-black/15 bg-white text-[#14211b]`}>Call {b.phone}</TrackedLink> : null}
              </div>
            </div>
          </section>
        );
    }
  };

  return (
    <div className="@container min-h-full bg-[#fbfaf6] font-sans text-[#14211b]">
      {blocks.map((b) =>
        onSelect ? (
          <div key={b.id} onClick={() => onSelect(b.id)} className={selectedId === b.id ? "relative cursor-pointer outline outline-2 -outline-offset-2 outline-emerald-500" : "relative cursor-pointer hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-emerald-400/60"}>
            {render(b)}
          </div>
        ) : (
          <React.Fragment key={b.id}>{render(b)}</React.Fragment>
        )
      )}
      <footer className="px-5 py-8 text-center text-xs text-[#7b8a80]">© {business}</footer>
      {theme.floatingWhatsApp && wa ? (
        <TrackedLink pageId={pageId} preview={preview} name="whatsapp" href={wa} className={`${preview ? "absolute" : "fixed"} bottom-5 right-5 z-20 flex size-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg`}>
          <svg viewBox="0 0 24 24" className="size-7" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.4-.7a11.6 11.6 0 0 1-4.6-4.1c-.4-.6-1-1.6-1-3s.7-2.1 1-2.4c.3-.3.6-.4.8-.4h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .6l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.6 2 1.1 1 2 1.3 2.3 1.4.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.7-.1l2 .9c.3.2.5.2.6.4 0 .1 0 .7-.3 1.2Z" /></svg>
          <span className="sr-only">Chat on WhatsApp</span>
        </TrackedLink>
      ) : null}
    </div>
  );
}
