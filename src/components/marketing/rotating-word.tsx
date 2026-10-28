"use client";

import * as React from "react";

export type RotatingItem = { word: string; color: string };

/**
 * A word in a heading that changes every few seconds with a slide-up + fade, each in its own colour. All words sit in
 * the same grid cell so the line keeps the width of the longest word (no jumping layout). Screen readers hear the full
 * list once; people who prefer reduced motion see the first word only.
 */
export function RotatingWord({ items, interval = 2200 }: { items: RotatingItem[]; interval?: number }) {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    if (items.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % items.length), interval);
    return () => window.clearInterval(t);
  }, [items.length, interval]);

  return (
    <span className="rotating-word">
      <span className="sr-only">{items.map((x) => x.word.replace(/\.$/, "")).join(", ")}</span>
      {items.map((x, n) => (
        <span key={x.word} aria-hidden="true" data-state={n === i ? "in" : "out"} style={{ color: x.color }}>
          {x.word}
        </span>
      ))}
    </span>
  );
}
