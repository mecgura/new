"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export type DropdownItem =
  | { type?: "item"; label: string; href?: string; onSelect?: () => void; tone?: "danger"; icon?: React.ReactNode }
  | { type: "separator" }
  | { type: "label"; label: string };

/** Menu button with full keyboard support: Enter/Space/↓ open, ↑↓ Home End move, Esc closes + restores focus. */
export function Dropdown({ trigger, items, align = "right", triggerLabel, triggerClassName }: { trigger: React.ReactNode; items: DropdownItem[]; align?: "left" | "right"; triggerLabel: string; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const focusables = () => Array.from(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    focusables()[0]?.focus();
    const away = (e: Event) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function close(restore = true) { setOpen(false); if (restore) btn.current?.focus(); }

  function onKeyDown(e: React.KeyboardEvent) {
    const els = focusables();
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  }

  const itemClass = (tone?: "danger") => cn("type-body flex min-h-control w-full items-center gap-2.5 rounded-md px-3 text-left hover:bg-surface-muted focus:bg-surface-muted focus:outline-none", tone === "danger" && "text-danger");

  return (
    <div ref={wrap} className="relative" onKeyDown={open ? onKeyDown : undefined}>
      <button ref={btn} type="button" aria-label={triggerLabel} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (!open && e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }} className={triggerClassName}>
        {trigger}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={triggerLabel} className={cn("absolute z-40 mt-2 min-w-56 rounded-lg border border-line bg-surface p-1.5 shadow-pop", align === "right" ? "right-0" : "left-0")}>
          {items.map((it, idx) => {
            if (it.type === "separator") return <div key={idx} role="separator" className="my-1 h-px bg-line" />;
            if (it.type === "label") return <p key={idx} className="type-caption px-3 py-1.5">{it.label}</p>;
            const content = <>{it.icon}{it.label}</>;
            return it.href ? (
              <Link key={idx} role="menuitem" href={it.href} className={itemClass(it.tone)} onClick={() => close(false)}>{content}</Link>
            ) : (
              <button key={idx} type="button" role="menuitem" className={itemClass(it.tone)} onClick={() => { close(); it.onSelect?.(); }}>{content}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}
