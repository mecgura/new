"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Shows on hover AND keyboard focus; linked via aria-describedby. */
export function Tooltip({ content, children, side = "top" }: { content: string; children: React.ReactElement<{ "aria-describedby"?: string }>; side?: "top" | "bottom" }) {
  const id = React.useId();
  const [show, setShow] = React.useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      onKeyDown={(e) => e.key === "Escape" && setShow(false)}
    >
      {React.cloneElement(children, { "aria-describedby": id })}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-app-border bg-app-elevated px-2 py-1 text-caption text-app-text shadow-[var(--shadow-pop)] transition-opacity",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          show ? "opacity-100" : "opacity-0"
        )}
      >
        {content}
      </span>
    </span>
  );
}
