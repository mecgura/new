"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComboboxOption = { value: string; label: string; description?: string };

/** ARIA 1.2 combobox with a filterable listbox (keyboard: ↑ ↓ Enter Escape). */
export function Combobox({
  id,
  options,
  value,
  onValueChange,
  placeholder = "Search…",
  emptyText = "No results",
  className,
  ...aria
}: {
  id?: string;
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-list`;
  const selected = options.find((o) => o.value === value) ?? null;
  const [query, setQuery] = React.useState(selected?.label ?? "");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const filtered = React.useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase())),
    [options, query]
  );

  const choose = (o: ComboboxOption) => {
    onValueChange(o.value);
    setQuery(o.label);
    setOpen(false);
  };

  return (
    <div className={cn("relative", className)}>
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, filtered.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && filtered[active]) {
            e.preventDefault();
            choose(filtered[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="h-10 w-full rounded-[var(--radius-control)] border border-app-border bg-app-bg px-3 text-body text-app-text placeholder:text-app-subtle focus:border-app-primary/70 focus:outline-none"
        {...aria}
      />
      {open ? (
        <ul id={listId} role="listbox" className="app-scroll absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--radius-control)] border border-app-border bg-app-surface py-1 shadow-[var(--shadow-pop)]">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-small text-app-muted">{emptyText}</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-small", i === active ? "bg-app-hover text-app-text" : "text-app-muted")}
              >
                <span>
                  {o.label}
                  {o.description ? <span className="block text-caption text-app-subtle">{o.description}</span> : null}
                </span>
                {o.value === value ? <Check className="size-4 text-app-primary" aria-hidden="true" /> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
