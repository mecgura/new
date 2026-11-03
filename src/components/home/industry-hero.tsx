"use client";

import * as React from "react";
import Link from "next/link";
import { BadgeCheck, Building2, CakeSlice, CheckCheck, GraduationCap, MessageCircle, Pause, Play, Scissors, Stethoscope, Store } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Home page hero: six industry slides where the headline, owner photo, category and WhatsApp chat change together.
 * Auto-advances every few seconds, pauses on hover/focus or with the pause button, and stays still for people who
 * prefer reduced motion. Every box has a fixed size so nothing jumps between slides.
 */
type ChatLine = { from: "customer" | "business"; text: string; time: string };
export type HeroSlideView = { id: string; category: string; business: string; headline: string; description: string; photoUrl: string | null; chat: ChatLine[] };

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { retail: Store, salon: Scissors, food: CakeSlice, education: GraduationCap, healthcare: Stethoscope, realestate: Building2 };
const SLIDE_MS = 4800;
const STEP_MS = 650;

function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function IndustryHero({ slides, whatsapp, signedIn, appHref }: { slides: HeroSlideView[]; whatsapp: string; signedIn: boolean; appHref: string }) {
  const [index, setIndex] = React.useState(0);
  const [hovered, setHovered] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [step, setStep] = React.useState(0); // how many chat lines are showing
  const [seen, setSeen] = React.useState<Set<number>>(() => new Set([0, 1]));
  const reduced = useReducedMotion();
  const n = slides.length;
  const slide = slides[index];
  const running = !reduced && !paused && !hovered && n > 1;

  const go = React.useCallback((i: number) => {
    const to = ((i % n) + n) % n;
    setIndex(to);
    setStep(0);
    // Keep this photo and the next one mounted so they are loaded before they show.
    setSeen((s) => (s.has(to) && s.has((to + 1) % n) ? s : new Set([...s, to, (to + 1) % n])));
  }, [n]);

  // Next slide after the conversation has had time to play.
  React.useEffect(() => {
    if (!running) return;
    const t = window.setTimeout(() => go(index + 1), SLIDE_MS + slide.chat.length * STEP_MS);
    return () => window.clearTimeout(t);
  }, [running, index, go, slide.chat.length]);

  // Messages appear one by one (all at once with reduced motion).
  React.useEffect(() => {
    if (reduced) return;
    if (step >= slide.chat.length) return;
    const t = window.setTimeout(() => setStep((s) => s + 1), step === 0 ? 350 : STEP_MS);
    return () => window.clearTimeout(t);
  }, [step, slide.chat.length, reduced, index]);
  const visible = reduced ? slide.chat.length : step;

  // Load this photo and the next one ahead of time.
  React.useEffect(() => {
    const next = (index + 1) % n;
    const url = slides[next]?.photoUrl;
    if (url) new Image().src = url;
  }, [index, n, slides]);

  const Icon = ICONS[slide.id] ?? Store;
  const nextIsBusiness = visible < slide.chat.length && slide.chat[visible]?.from === "business";
  const demoText = `Hi MECGURA, I would like a demo of WhatsApp automation for my ${slide.category.toLowerCase().split(" & ")[0]} business.`;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="How MECGURA helps different businesses"
      className="hero-x mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-10 lg:grid-cols-[1.05fr_1fr] lg:pt-14"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setHovered(false)}
    >
      <div>
        <p className="wa-pill">
          <BadgeCheck className="size-3.5" aria-hidden="true" /> Official WhatsApp Business API · set up by our team
        </p>

        <div aria-live={running ? "off" : "polite"} aria-atomic="true">
          <p key={`c-${slide.id}`} className="hero-in mt-6 inline-flex items-center gap-2 rounded-full bg-[#0f5132]/10 px-3 py-1 text-sm font-semibold text-[#0f5132]">
            <Icon className="size-4" /> {slide.category}
          </p>
          <h1 className="mt-4 min-h-[3.3em] font-display text-[2.35rem] font-bold leading-[1.1] text-[#10231a] sm:min-h-[2.25em] sm:text-5xl lg:min-h-[3.3em] lg:text-[3.5rem]">
            {slide.headline.split(" ").map((w, i, all) => (
              <React.Fragment key={`${slide.id}-${i}`}>
                <span className={cn("hero-word inline-block", (w.toLowerCase().startsWith("whatsapp") || i === all.length - 1) && "text-[#128c4a]")} style={{ animationDelay: `${i * 55}ms` }}>
                  {w}
                </span>{" "}
              </React.Fragment>
            ))}
          </h1>
          <p key={`d-${slide.id}`} className="hero-in wa-muted mt-4 min-h-[5.25em] max-w-xl text-lg sm:min-h-[3.5em]" style={{ animationDelay: "160ms" }}>
            {slide.description}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(demoText)}`} data-track="demo_hero" className="hero-cta">
            <MessageCircle className="size-5" aria-hidden="true" /> Book a free demo
          </a>
          <Link href={appHref} className="wa-btn wa-btn-ghost">
            {signedIn ? "Open workspace" : "Client sign in"}
          </Link>
        </div>
        <ul className="wa-muted mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {["Live in about a day", "Usually on your existing number", "A real person on call"].map((t) => (
            <li key={t} className="inline-flex items-center gap-1.5">
              <BadgeCheck className="size-4 text-[#128c4a]" aria-hidden="true" /> {t}
            </li>
          ))}
        </ul>

        {n > 1 ? (
          <div className="mt-7 flex items-center gap-3">
            <div className="flex items-center gap-1.5" role="group" aria-label="Choose a business">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Show ${s.category}`}
                  aria-current={i === index ? "true" : undefined}
                  className={cn("relative h-2.5 overflow-hidden rounded-full transition-all duration-300", i === index ? "w-10 bg-[#0f5132]/20" : "w-2.5 bg-[#0f5132]/25 hover:bg-[#0f5132]/45")}
                >
                  {i === index ? <span key={`p-${index}`} className={cn("hero-progress absolute inset-y-0 left-0 bg-[#128c4a]", !running && "hero-progress-paused")} style={{ animationDuration: `${SLIDE_MS + slide.chat.length * STEP_MS}ms` }} /> : null}
                </button>
              ))}
            </div>
            {!reduced ? (
              <button type="button" onClick={() => setPaused((p) => !p)} className="grid size-8 place-items-center rounded-full text-[#0f5132] hover:bg-[#0f5132]/10" aria-label={paused ? "Play slides" : "Pause slides"}>
                {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Photo + conversation */}
      <div className="relative mx-auto w-full max-w-[26rem] pb-28 sm:pb-24 lg:mr-0">
        <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] bg-[#0f5132] shadow-[0_30px_60px_-25px_rgba(15,81,50,0.55)]">
          {slides.map((s, i) => {
            if (!seen.has(i) && i !== index) return null;
            const SIcon = ICONS[s.id] ?? Store;
            return (
              <div key={s.id} className={cn("absolute inset-0 transition-opacity duration-700", i === index ? "opacity-100" : "opacity-0")} aria-hidden={i !== index}>
                {s.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small WebP served by our own route
                  <img src={s.photoUrl} alt={i === index ? `${s.category} business owner` : ""} className={cn("size-full object-cover", i === index && !reduced && "hero-zoom")} decoding="async" fetchPriority={i === index ? "high" : "low"} />
                ) : (
                  <div className="hero-fallback grid size-full place-items-center pb-[45%]">
                    <div className="text-center text-white/90">
                      <SIcon className="mx-auto size-16 opacity-90" />
                      <p className="mt-4 font-display text-2xl font-bold">{s.business}</p>
                      <p className="mt-1 text-sm text-white/70">{s.category}</p>
                    </div>
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/45 to-transparent" />
              </div>
            );
          })}
          <p key={`tag-${slide.id}`} className="hero-in absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-[#10231a] shadow backdrop-blur">
            <Icon className="size-3.5 text-[#128c4a]" /> {slide.business}
          </p>
        </div>

        <div className="absolute -bottom-2 left-1/2 w-[92%] -translate-x-1/2 overflow-hidden rounded-2xl border border-black/5 bg-[#efeae2] shadow-2xl sm:-left-10 sm:w-[21rem] sm:translate-x-0 lg:-left-16" aria-hidden="true">
          <div className="flex items-center gap-2.5 bg-[#075e54] px-3.5 py-2.5 text-white">
            <span className="grid size-8 place-items-center rounded-full bg-white/15 text-sm font-bold">{slide.business[0]}</span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight">{slide.business}</p>
              <p className="text-[11px] text-white/80">{nextIsBusiness && visible > 0 ? "typing…" : "online"}</p>
            </div>
          </div>
          <div className="flex h-[15.5rem] flex-col justify-end gap-1.5 overflow-hidden px-3 py-3">
            {slide.chat.slice(0, visible).map((m, i) => (
              <div key={`${slide.id}-${i}`} className={cn("hero-bubble max-w-[85%] rounded-lg px-2.5 py-1.5 text-[13px] leading-snug text-[#111b21] shadow-sm", m.from === "business" ? "self-end rounded-tr-none bg-[#d9fdd3]" : "self-start rounded-tl-none bg-white")}>
                {m.text}
                <span className="ml-2 inline-flex translate-y-0.5 items-center gap-0.5 whitespace-nowrap text-[10px] text-[#667781]">
                  {m.time}
                  {m.from === "business" ? <CheckCheck className="size-3 text-[#53bdeb]" /> : null}
                </span>
              </div>
            ))}
            {!reduced && nextIsBusiness && visible > 0 ? (
              <div className="self-end rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 shadow-sm">
                <span className="hero-typing" />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
