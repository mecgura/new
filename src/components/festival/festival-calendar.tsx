"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type CalendarFestival = { id: string; name: string; emoji: string; start: string; days: number };

const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const between = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Month view of the festival calendar, with today's festival and what's coming next. */
export function FestivalCalendar({ festivals, today }: { festivals: CalendarFestival[]; today: string }) {
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [picked, setPicked] = useState(today);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarFestival[]>();
    for (const f of festivals) for (let i = 0; i < f.days; i++) {
      const k = addDays(f.start, i);
      map.set(k, [...(map.get(k) ?? []), f]);
    }
    return map;
  }, [festivals]);

  const first = new Date(Date.UTC(ym.y, ym.m, 1));
  const daysInMonth = new Date(Date.UTC(ym.y, ym.m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => iso(ym.y, ym.m, i + 1))];
  const move = (d: number) => setYm(({ y, m }) => ({ y: m + d < 0 ? y - 1 : m + d > 11 ? y + 1 : y, m: (m + d + 12) % 12 }));

  const todays = byDay.get(today) ?? [];
  const upcoming = festivals.filter((f) => addDays(f.start, f.days - 1) >= today).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 5);
  const pickedList = byDay.get(picked) ?? [];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="wa-card p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => move(-1)} aria-label="Previous month" className="grid size-10 place-items-center rounded-full hover:bg-[#e7f7ee]"><ChevronLeft className="size-5" aria-hidden="true" /></button>
          <p className="font-display text-lg font-bold" aria-live="polite">{monthFmt.format(first)}</p>
          <button type="button" onClick={() => move(1)} aria-label="Next month" className="grid size-10 place-items-center rounded-full hover:bg-[#e7f7ee]"><ChevronRight className="size-5" aria-hidden="true" /></button>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-[#667781]">
          {WEEK.map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={`e${i}`} />;
            const fs = byDay.get(d) ?? [];
            const isToday = d === today;
            const isPicked = d === picked;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setPicked(d)}
                aria-label={`${dayFmt.format(new Date(`${d}T00:00:00Z`))}${fs.length ? `: ${fs.map((f) => f.name).join(", ")}` : ""}`}
                aria-pressed={isPicked}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-xl text-sm transition-colors ${fs.length ? "bg-[#fff4d6] font-bold text-[#7a3e00]" : "hover:bg-[#f0f2f5]"} ${isToday ? "ring-2 ring-[#128c7e]" : ""} ${isPicked ? "!bg-[#128c7e] !text-white" : ""}`}
              >
                <span>{Number(d.slice(8))}</span>
                {fs.length ? <span className="text-sm leading-none sm:text-base" aria-hidden="true">{fs[0].emoji || "🎉"}</span> : null}
              </button>
            );
          })}
        </div>
        <p className="mt-4 min-h-6 text-sm text-[#54656f]" aria-live="polite">
          <span className="font-semibold text-[#111b21]">{dayFmt.format(new Date(`${picked}T00:00:00Z`))}:</span>{" "}
          {pickedList.length ? pickedList.map((f) => `${f.emoji} ${f.name}`).join(" · ") : "No festival this day."}
        </p>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl bg-[linear-gradient(140deg,#075e54,#128c7e)] p-5 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Today</p>
          {todays.length ? (
            todays.map((f) => <p key={f.id} className="mt-1 font-display text-2xl font-bold">{f.emoji} {f.name}</p>)
          ) : (
            <p className="mt-1 font-display text-xl font-bold">{dayFmt.format(new Date(`${today}T00:00:00Z`))}</p>
          )}
          {!todays.length && upcoming[0] ? <p className="mt-1 text-sm text-white/85">Next: {upcoming[0].emoji} {upcoming[0].name} in {between(today, upcoming[0].start)} days</p> : null}
        </div>
        <div className="wa-card p-5">
          <p className="font-bold">Coming up</p>
          <ul className="mt-3 space-y-3">
            {upcoming.map((f) => {
              const n = between(today, f.start);
              return (
                <li key={f.id} className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#fff4d6] text-xl" aria-hidden="true">{f.emoji || "🎉"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{f.name}</p>
                    <p className="text-xs text-[#667781]">{dayFmt.format(new Date(`${f.start}T00:00:00Z`))}</p>
                  </div>
                  <span className={`wa-pill shrink-0 ${n <= 0 ? "" : "wa-pill-soon"}`}>{n <= 0 ? "Today" : n === 1 ? "Tomorrow" : `${n} days`}</span>
                </li>
              );
            })}
            {!upcoming.length ? <li className="text-sm text-[#667781]">No festivals added yet.</li> : null}
          </ul>
        </div>
      </div>
    </div>
  );
}
