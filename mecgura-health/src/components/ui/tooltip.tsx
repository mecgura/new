"use client";
import { useId, useState } from "react";

/** Short text hint on hover AND keyboard focus, linked via aria-describedby. Don't hide essential info here. */
export function Tooltip({ text, children }: { text: string; children: React.ReactElement<React.HTMLAttributes<HTMLElement>> }) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} onFocus={() => setShow(true)} onBlur={() => setShow(false)} onKeyDown={(e) => e.key === "Escape" && setShow(false)}>
      <span aria-describedby={id} className="inline-flex">{children}</span>
      <span id={id} role="tooltip" className={`type-caption pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 !text-on-brand shadow-pop ${show ? "block" : "hidden"}`}>{text}</span>
    </span>
  );
}
