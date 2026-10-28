"use client";

import { useEffect, useState } from "react";
import { Gift, MessageCircle, X } from "lucide-react";

export type PublicPromo = {
  id: string;
  name: string;
  emoji: string;
  phase: "pre" | "live";
  offer: string;
  offerCode: string;
  discountPercent: number;
  startsOn: string;
  endsOn: string;
  startLabel: string;
  endLabel: string;
};

const store = {
  get(kind: "local" | "session", k: string) {
    try {
      return (kind === "local" ? window.localStorage : window.sessionStorage).getItem(k);
    } catch {
      return null;
    }
  },
  set(kind: "local" | "session", k: string, v: string) {
    try {
      (kind === "local" ? window.localStorage : window.sessionStorage).setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

/** Start of the festival / end of its last day, in India time. */
const target = (p: PublicPromo) => (p.phase === "pre" ? Date.parse(`${p.startsOn}T00:00:00+05:30`) : Date.parse(`${p.endsOn}T23:59:59+05:30`));

function left(ms: number) {
  if (ms <= 0) return "";
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

function useCountdown(p: PublicPromo) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return now === null ? "" : left(target(p) - now);
}

export const claimLink = (p: PublicPromo, whatsapp: string) =>
  `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hi MECGURA, I want the ${p.name} offer${p.offerCode ? ` (code ${p.offerCode})` : ""}.`)}`;

/** Slim offer bar at the very top of the website, from a few days before the festival until it ends. */
export function FestivalPromoBar({ promo, whatsapp }: { promo: PublicPromo; whatsapp: string }) {
  const [hidden, setHidden] = useState(false);
  const countdown = useCountdown(promo);
  useEffect(() => {
    const t = setTimeout(() => setHidden(store.get("session", `mgc_bar_${promo.id}`) === "1"), 0);
    return () => clearTimeout(t);
  }, [promo.id]);
  if (hidden || !promo.offer) return null;
  return (
    <div className="fest-bar relative text-white" role="region" aria-label={`${promo.name} offer`}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-10 py-2 text-center text-[13px] sm:text-sm">
        <span aria-hidden="true">{promo.emoji || "🎉"}</span>
        <span className="font-bold">{promo.phase === "pre" ? `${promo.name} offer is live early:` : `${promo.name} offer:`}</span>
        <span>{promo.offer}</span>
        {promo.offerCode ? <span className="rounded bg-white/20 px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider">{promo.offerCode}</span> : null}
        {countdown ? <span className="text-white/85">· {promo.phase === "pre" ? `${promo.name} in ${countdown}` : `Ends in ${countdown}`}</span> : null}
        <a href={claimLink(promo, whatsapp)} target="_blank" rel="noreferrer" className="font-bold underline underline-offset-2 hover:no-underline">
          Claim now →
        </a>
      </div>
      <button
        type="button"
        aria-label="Hide offer bar"
        onClick={() => {
          store.set("session", `mgc_bar_${promo.id}`, "1");
          setHidden(true);
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-white/20"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** A small advert card that slides in once per visitor per festival, a few seconds after they arrive. */
export function FestivalPromoPopup({ promo, whatsapp, preview = false }: { promo: PublicPromo; whatsapp: string; preview?: boolean }) {
  const [open, setOpen] = useState(false);
  const countdown = useCountdown(promo);
  useEffect(() => {
    if (!promo.offer) return;
    const t = setTimeout(() => {
      // Phones already see the offer bar and banner; a popup there would cover the page.
      if (preview) return setOpen(true);
      if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 639px)").matches) return;
      if (store.get("local", `mgc_pop_${promo.id}`)) return;
      store.set("local", `mgc_pop_${promo.id}`, "1");
      setOpen(true);
    }, preview ? 1500 : 6000);
    return () => clearTimeout(t);
  }, [promo.id, promo.offer, preview]);
  if (!open) return null;
  // "20% off on all MECGURA plans" → big "20% OFF" + "on all MECGURA plans"; a custom offer keeps its own words.
  const auto = promo.discountPercent > 0 && promo.offer.toLowerCase().startsWith(`${promo.discountPercent}% off`);
  const headline = auto ? `${promo.discountPercent}% OFF` : promo.discountPercent > 0 ? `${promo.discountPercent}% OFF` : promo.name;
  const subline = auto ? promo.offer.slice(`${promo.discountPercent}% off`.length).trim() : promo.offer;
  return (
    <div role="dialog" aria-label={`${promo.name} offer`} className="fest-pop fixed bottom-4 left-4 z-50 w-[min(21rem,calc(100vw-6.5rem))] overflow-hidden rounded-2xl text-white shadow-2xl sm:bottom-6 sm:left-6">
      <button type="button" aria-label="Close offer" onClick={() => setOpen(false)} className="absolute right-2 top-2 z-10 rounded-full bg-white/15 p-1 hover:bg-white/25">
        <X className="size-4" aria-hidden="true" />
      </button>
      <div className="p-5">
        <p className="text-3xl" aria-hidden="true">{promo.emoji || "🎁"}</p>
        <p className="mt-1 text-xs font-bold uppercase tracking-widest text-white/80">{promo.phase === "pre" ? "Early festive offer" : "Festive offer"}</p>
        <p className="mt-1 font-display text-2xl font-bold leading-tight">
          {headline}
          {subline ? <span className="block text-base font-semibold text-white/90">{subline}</span> : null}
        </p>
        <p className="mt-2 text-xs text-white/85">
          {promo.offerCode ? <>Code <span className="rounded bg-white/20 px-1.5 py-0.5 font-mono font-bold tracking-wider">{promo.offerCode}</span> · </> : null}
          {promo.phase === "pre" ? `${promo.name} on ${promo.startLabel}` : `Valid till ${promo.endLabel}`}
          {countdown ? ` · ${countdown} left` : ""}
        </p>
        <a href={claimLink(promo, whatsapp)} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full bg-white font-bold text-[#3b0a45] hover:bg-white/90">
          <MessageCircle className="size-4" aria-hidden="true" /> Claim on WhatsApp
        </a>
      </div>
    </div>
  );
}

/** Small "festive price" tag for pricing cards. */
export function FestivePriceTag({ percent, name }: { percent: number; name: string }) {
  return (
    <span className="fest-tag inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold text-white">
      <Gift className="size-3.5" aria-hidden="true" /> {name} −{percent}%
    </span>
  );
}
