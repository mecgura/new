"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";

/** Accessible disclosure menu for small screens: button toggles a labelled nav; Esc / link click closes and returns focus. */
export function MobileMenu({ items }: { items: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  return (
    <div className="md:hidden">
      <button ref={btn} type="button" aria-expanded={open} aria-controls="site-mobile-nav" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)} className="flex size-control items-center justify-center rounded-md border border-line-strong">
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
      </button>
      {open && (
        <nav id="site-mobile-nav" aria-label="Site navigation" className="absolute inset-x-0 top-full border-b border-line bg-surface px-4 py-3 shadow-pop">
          <ul className="flex flex-col">
            {items.map((i) => <li key={i.href}><Link href={i.href} onClick={() => setOpen(false)} className="flex min-h-control items-center rounded-md px-2 text-base font-medium !text-ink no-underline hover:bg-surface-muted">{i.label}</Link></li>)}
          </ul>
        </nav>
      )}
    </div>
  );
}
