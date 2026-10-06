"use client";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface TabItem { key: string; label: string; content: React.ReactNode }

/** WAI-ARIA tabs: ←/→ move, Home/End jump; panels are labelled by their tab. */
export function Tabs({ tabs, defaultKey, label }: { tabs: TabItem[]; defaultKey?: string; label: string }) {
  const [active, setActive] = useState(defaultKey ?? tabs[0]?.key);
  const id = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.key === active);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next >= 0) { e.preventDefault(); setActive(tabs[next].key); refs.current[tabs[next].key]?.focus(); }
  }

  return (
    <div>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button key={t.key} ref={(el) => { refs.current[t.key] = el; }} role="tab" type="button" id={`${id}-${t.key}`} aria-selected={active === t.key} aria-controls={`${id}-p-${t.key}`} tabIndex={active === t.key ? 0 : -1} onClick={() => setActive(t.key)}
            className={cn("type-label -mb-px min-h-control shrink-0 whitespace-nowrap border-b-2 px-4", active === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink")}>
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" id={`${id}-p-${t.key}`} aria-labelledby={`${id}-${t.key}`} hidden={active !== t.key} tabIndex={0} className="pt-4">{active === t.key && t.content}</div>
      ))}
    </div>
  );
}
