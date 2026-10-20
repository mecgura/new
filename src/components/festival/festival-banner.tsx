"use client";

import { useEffect, useState } from "react";
import { Gift, MessageCircle, X } from "lucide-react";
import { FestivalEffect, type EffectKind } from "@/components/festival/festival-effect";

export type PublicFestival = { id: string; name: string; emoji: string; greeting: string; offer: string; offerCode: string; effect: EffectKind; photoUrl: string | null; endsLabel: string };

const seenKey = (id: string, who: string) => `mgc_fx_${who}_${id}`;
const read = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

/** Plays the festival effect once per browser per festival. */
function useOncePerFestival(id: string, who: string) {
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (read(seenKey(id, who))) return;
      write(seenKey(id, who), "1");
      setPlay(true);
    }, 700);
    return () => clearTimeout(t);
  }, [id, who]);
  return [play, setPlay] as const;
}

/** Home page greeting banner for the current festival, with its offer and a one-time screen effect. */
export function FestivalSiteBanner({ festival, whatsapp }: { festival: PublicFestival; whatsapp: string }) {
  const [hidden, setHidden] = useState(false);
  const [play, setPlay] = useOncePerFestival(festival.id, "site");
  const claim = `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hi MECGURA, I saw your ${festival.name} offer${festival.offerCode ? ` (${festival.offerCode})` : ""}.`)}`;
  if (hidden) return play ? <FestivalEffect kind={festival.effect} onDone={() => setPlay(false)} /> : null;
  return (
    <>
      {play ? <FestivalEffect kind={festival.effect} onDone={() => setPlay(false)} /> : null}
      <section aria-label={`${festival.name} greetings`} className="mx-auto max-w-6xl px-4 pt-6">
        <div className="relative overflow-hidden rounded-3xl bg-[linear-gradient(120deg,#3b0a45,#7a1f3d_45%,#c2410c)] text-white shadow-xl">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-30 [background:radial-gradient(circle_at_20%_20%,#ffd16688,transparent_35%),radial-gradient(circle_at_80%_70%,#ffb70388,transparent_40%)]" />
          <button type="button" onClick={() => setHidden(true)} aria-label="Close greeting" className="absolute right-3 top-3 z-10 rounded-full bg-white/15 p-1.5 hover:bg-white/25">
            <X className="size-4" aria-hidden="true" />
          </button>
          <div className={`relative grid items-center gap-5 p-5 sm:p-8 ${festival.photoUrl ? "md:grid-cols-[1fr_minmax(0,22rem)]" : ""}`}>
            <div>
              <p className="text-4xl" aria-hidden="true">{festival.emoji || "🎉"}</p>
              <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl">Happy {festival.name}!</h2>
              {festival.greeting ? <p className="mt-2 max-w-xl text-white/90">{festival.greeting}</p> : null}
              {festival.offer ? (
                <div className="mt-5 inline-flex max-w-full flex-wrap items-center gap-3 rounded-2xl bg-white/12 p-3 ring-1 ring-white/25 backdrop-blur">
                  <Gift className="size-6 shrink-0 text-[#ffd166]" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="font-bold">{festival.offer}</p>
                    <p className="text-xs text-white/80">
                      {festival.offerCode ? <>Code <span className="rounded bg-white/20 px-1.5 py-0.5 font-mono font-bold tracking-wider">{festival.offerCode}</span> · </> : null}
                      Valid till {festival.endsLabel}
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-3">
                <a href={claim} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#25d366] px-5 font-bold text-[#06281a] hover:brightness-95">
                  <MessageCircle className="size-5" aria-hidden="true" /> {festival.offer ? "Claim on WhatsApp" : "Say hello on WhatsApp"}
                </a>
                {festival.effect !== "none" ? (
                  <button type="button" onClick={() => setPlay(true)} className="inline-flex min-h-11 items-center rounded-full bg-white/15 px-5 font-semibold hover:bg-white/25">
                    Celebrate again {festival.emoji}
                  </button>
                ) : null}
              </div>
            </div>
            {festival.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={festival.photoUrl} alt={`${festival.name} from MECGURA`} className="max-h-72 w-full rounded-2xl object-cover shadow-lg ring-1 ring-white/20" />
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}

/** One-time greeting card in a client's workspace on a festival day. */
export function FestivalGreeting({ festival, orgName, userId }: { festival: PublicFestival; orgName: string; userId: string }) {
  const [play, setPlay] = useOncePerFestival(festival.id, `u${userId}`);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (play) {
      const t = setTimeout(() => setOpen(true), 0);
      return () => clearTimeout(t);
    }
  }, [play]);
  return (
    <>
      {play ? <FestivalEffect kind={festival.effect} onDone={() => setPlay(false)} /> : null}
      {open ? (
        <div role="dialog" aria-modal="true" aria-label={`Happy ${festival.name}`} className="fixed inset-0 z-[55] grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-[linear-gradient(140deg,#3b0a45,#7a1f3d_50%,#c2410c)] text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {festival.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={festival.photoUrl} alt="" className="max-h-56 w-full object-cover" />
            ) : null}
            <div className="p-6 text-center">
              <p className="text-5xl" aria-hidden="true">{festival.emoji || "🎉"}</p>
              <h2 className="mt-2 font-display text-2xl font-bold">Happy {festival.name}{orgName ? `, ${orgName}` : ""}!</h2>
              {festival.greeting ? <p className="mt-2 text-white/90">{festival.greeting}</p> : null}
              {festival.offer ? (
                <p className="mt-4 rounded-2xl bg-white/12 p-3 text-sm ring-1 ring-white/25">
                  🎁 <span className="font-bold">{festival.offer}</span>
                  {festival.offerCode ? <> · Code <span className="font-mono font-bold">{festival.offerCode}</span></> : null}
                </p>
              ) : null}
              <p className="mt-4 text-sm text-white/80">Warm wishes from the MECGURA team.</p>
              <button type="button" onClick={() => setOpen(false)} className="mt-5 inline-flex min-h-11 items-center rounded-full bg-white px-6 font-bold text-[#3b0a45] hover:bg-white/90">
                Thank you!
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
