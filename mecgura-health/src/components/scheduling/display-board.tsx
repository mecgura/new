"use client";
import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { usePolling } from "./use-poll";
import { cn } from "@/lib/cn";

interface Snap { clinicName: string; date: string; time: string; voice: boolean; doctors: { name: string; room: string | null; serving: { token: string; status: string; emergency: boolean }[]; next: string[]; waitingCount: number }[]; announcements: { id: string; token: string; doctor: string; room: string | null }[] }

/**
 * Waiting-room screen. Shows TOKENS ONLY — the server never sends names. Polls; the voice announcement uses the
 * browser's own speech synthesis (needs one click to enable because browsers block autoplay audio).
 */
export function DisplayBoard({ displayKey }: { displayKey: string }) {
  const { data, error, loading } = usePolling<Snap>(`/api/public/display/${displayKey}`, { intervalMs: 4000 });
  const [voiceOn, setVoiceOn] = useState(false);
  const spoken = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    if (!data) return;
    if (!primed.current) { data.announcements.forEach((a) => spoken.current.add(a.id)); primed.current = true; return; } // don't re-announce on first load
    if (!voiceOn || !data.voice || typeof speechSynthesis === "undefined") { data.announcements.forEach((a) => spoken.current.add(a.id)); return; }
    for (const a of data.announcements) {
      if (spoken.current.has(a.id)) continue;
      spoken.current.add(a.id);
      const u = new SpeechSynthesisUtterance(`Token ${a.token.replace(/-/g, " ")}, please go to ${a.room ?? a.doctor}`);
      u.rate = 0.9; speechSynthesis.speak(u);
    }
  }, [data, voiceOn]);

  if (loading && !data) return <main id="content" className="flex min-h-dvh items-center justify-center bg-app p-6"><p role="status" className="text-2xl">Loading…</p></main>;
  if (error && !data) return <main id="content" className="flex min-h-dvh items-center justify-center bg-app p-6 text-center"><div><h1 className="text-3xl font-bold">Display unavailable</h1><p className="mt-2 text-xl text-muted">{error.code === "NOT_FOUND" ? "This screen link is not active. Ask the clinic for a new link." : "Trying to reconnect…"}</p></div></main>;
  if (!data) return null;

  return (
    <main id="content" className="min-h-dvh bg-ink p-4 text-surface sm:p-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-3xl font-bold sm:text-5xl">{data.clinicName}</h1><p className="text-lg opacity-80 sm:text-2xl">Now serving</p></div>
        <div className="flex items-center gap-4"><p className="text-3xl font-semibold tabular-nums sm:text-5xl" aria-label="Current time">{data.time}</p>
          {data.voice && <button type="button" onClick={() => { setVoiceOn((v) => !v); if (!voiceOn && typeof speechSynthesis !== "undefined") speechSynthesis.speak(new SpeechSynthesisUtterance("Announcements on")); }} aria-pressed={voiceOn} className="inline-flex min-h-control items-center gap-2 rounded-md border border-surface/40 px-4 text-lg hover:bg-surface/10">
            {voiceOn ? <Volume2 aria-hidden className="size-6" /> : <VolumeX aria-hidden className="size-6" />}{voiceOn ? "Voice on" : "Turn voice on"}</button>}</div>
      </header>
      {error && <p role="status" className="mb-4 rounded-md bg-warning-soft p-3 text-lg text-warning">Connection problem — the screen may be out of date.</p>}
      {!data.doctors.length && <p className="text-2xl opacity-80">No doctors are available today.</p>}
      <div className={cn("grid gap-4 sm:gap-6", data.doctors.length > 1 ? "lg:grid-cols-2" : "")}>
        {data.doctors.map((d) => (
          <section key={d.name} aria-label={d.name} className="rounded-modal bg-surface p-5 text-ink sm:p-8">
            <h2 className="text-2xl font-bold sm:text-3xl">{d.name}</h2>
            {d.room && <p className="text-lg text-muted sm:text-xl">{d.room}</p>}
            <div className="mt-5">
              {d.serving.length ? d.serving.map((s) => (
                <p key={s.token} className={cn("flex flex-wrap items-baseline gap-3", s.emergency && "text-emergency")}>
                  <span className="text-7xl font-extrabold tabular-nums sm:text-9xl">{s.token}</span>
                  <span className="text-xl font-semibold sm:text-2xl">{s.status === "CALLED" ? "Please come in" : "In consultation"}</span>
                </p>
              )) : <p className="text-2xl text-muted">—</p>}
            </div>
            {d.next.length > 0 && <p className="mt-5 text-xl sm:text-2xl"><span className="text-muted">Next: </span><span className="font-bold tabular-nums">{d.next.join("  ·  ")}</span></p>}
            <p className="mt-2 text-lg text-muted">{d.waitingCount} waiting</p>
          </section>
        ))}
      </div>
    </main>
  );
}
