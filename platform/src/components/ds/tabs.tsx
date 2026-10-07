"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type TabItem = { id: string; label: string; disabled?: boolean };

/** WAI-ARIA tabs: arrow keys move between tabs, panels are labelled by their tab. */
export function Tabs({
  items,
  value,
  onValueChange,
  label,
  className,
}: {
  items: TabItem[];
  value: string;
  onValueChange: (id: string) => void;
  label: string;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = items.filter((t) => !t.disabled);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = enabled.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % enabled.length;
    if (e.key === "ArrowLeft") next = (i - 1 + enabled.length) % enabled.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = enabled.length - 1;
    if (next >= 0) {
      e.preventDefault();
      const id = enabled[next].id;
      onValueChange(id);
      refs.current[items.findIndex((t) => t.id === id)]?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn("app-scroll flex gap-1 overflow-x-auto border-b border-app-border", className)}>
      {items.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onValueChange(t.id)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-small font-medium transition-colors disabled:opacity-40",
              active ? "border-app-primary text-app-text" : "border-transparent text-app-muted hover:text-app-text"
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, active, children }: { id: string; active: boolean; children: React.ReactNode }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0} className="pt-6 outline-none">
      {children}
    </div>
  );
}
