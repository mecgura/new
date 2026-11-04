"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Circle, Rocket, X } from "lucide-react";
import { Card } from "@/components/ds";

type Item = { done: boolean; label: string; href: string };

/** Setup checklist: a slim progress bar that expands; can be hidden (remembered on this device). Gone once everything is done. */
export function GettingStarted({ orgId, items }: { orgId: string; items: Item[] }) {
  const key = `mecgura-setup-hidden:${orgId}`;
  const [hidden, setHidden] = React.useState(true); // assume hidden until read, so it never flashes
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        setHidden(window.localStorage.getItem(key) === "1");
      } catch {
        setHidden(false);
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [key]);
  const done = items.filter((i) => i.done).length;
  if (hidden || done === items.length) return null;
  const pct = Math.round((done / items.length) * 100);
  const hide = () => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* private mode: hide for this visit */
    }
    setHidden(true);
  };
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-app-primary/15 text-app-primary"><Rocket className="size-4" aria-hidden="true" /></span>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <p className="flex items-center gap-2 text-small font-semibold text-app-text">
            Finish setting up · {done} of {items.length} done
            <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </p>
          <span className="mt-1.5 block h-1.5 w-full max-w-md overflow-hidden rounded-full bg-app-border">
            <span className="block h-full rounded-full bg-app-primary" style={{ width: `${pct}%` }} />
          </span>
        </button>
        <button type="button" onClick={hide} className="grid size-8 shrink-0 place-items-center rounded-lg text-app-subtle hover:bg-app-hover hover:text-app-text" aria-label="Hide setup checklist">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {open ? (
        <ul className="grid gap-2 border-t border-app-border px-5 py-3 sm:grid-cols-2">
          {items.map((c) => (
            <li key={c.label} className="flex items-start gap-2 text-small">
              {c.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-app-success" aria-hidden="true" /> : <Circle className="mt-0.5 size-4 shrink-0 text-app-subtle" aria-hidden="true" />}
              {c.done ? <span className="text-app-muted line-through">{c.label}</span> : <Link href={c.href} className="text-app-text hover:underline">{c.label}</Link>}
              <span className="sr-only">{c.done ? " (done)" : " (to do)"}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
