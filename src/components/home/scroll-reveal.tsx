"use client";

import { useEffect } from "react";

/** Fades sections in as they scroll into view. Elements opt in with data-reveal. */
export function ScrollReveal() {
  useEffect(() => {
    const root = document.querySelector(".wa-root");
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    if (!root || typeof IntersectionObserver === "undefined") return;
    root.classList.add("wa-js");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    items.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      root.classList.remove("wa-js");
    };
  }, []);
  return null;
}
