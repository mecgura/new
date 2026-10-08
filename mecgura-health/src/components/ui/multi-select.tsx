"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { controlClass } from "./field";

/** Accessible multi-select: a disclosure button + a group of checkboxes. Submits as repeated form values. */
export function MultiSelect({ label, name, options, value, onChange, placeholder = "Select…" }: { label: string; name?: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const selected = options.filter((o) => value.includes(o.value));
  return (
    <div ref={ref} className="relative">
      <span id={`${id}-l`} className="type-label mb-1.5 block">{label}</span>
      <button type="button" aria-haspopup="true" aria-expanded={open} aria-labelledby={`${id}-l ${id}-b`} onClick={() => setOpen((o) => !o)} className={cn(controlClass, "flex items-center justify-between gap-2 text-left")}>
        <span id={`${id}-b`} className={cn("truncate", !selected.length && "text-muted")}>{selected.length ? selected.map((s) => s.label).join(", ") : placeholder}</span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted" />
      </button>
      {open && (
        <div role="group" aria-labelledby={`${id}-l`} className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-surface p-1.5 shadow-pop">
          {options.map((o) => (
            <label key={o.value} className="flex min-h-control cursor-pointer items-center gap-3 rounded-md px-2.5 hover:bg-surface-muted">
              <input type="checkbox" className="size-5 accent-[var(--brand-primary)]" checked={value.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))} />
              <span className="type-body">{o.label}</span>
            </label>
          ))}
        </div>
      )}
      {name && value.map((v) => <input key={v} type="hidden" name={name} value={v} />)}
    </div>
  );
}
