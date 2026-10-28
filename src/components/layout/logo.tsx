"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

/**
 * Official MECGURA logo, transparent background (230x70):
 * - `public/logo-light.png`: dark "MECGURA" text, for light backgrounds.
 * - `public/logo.png`: white "MECGURA" text, for dark backgrounds.
 * `tone="auto"` follows the app's light/dark theme; pages with a fixed background pick their tone.
 */
const SRC = { light: "/logo-light.png", dark: "/logo.png" } as const;

export function Logo({ className, href = "/", tone = "auto" }: { className?: string; href?: string; tone?: "auto" | "light" | "dark" }) {
  const [failed, setFailed] = useState(false);
  const img = (src: string, extra = "") => (
    <Image src={src} alt="MECGURA logo" width={184} height={56} priority className={cn("h-10 w-auto", extra)} onError={() => setFailed(true)} />
  );

  return (
    <Link href={href} className={cn("group inline-flex items-center", className)} aria-label="MECGURA home">
      {!failed ? (
        tone === "light" ? (
          img(SRC.light)
        ) : tone === "dark" ? (
          img(SRC.dark)
        ) : (
          <>
            {img(SRC.light, "dark:hidden")}
            {img(SRC.dark, "hidden dark:block")}
          </>
        )
      ) : (
        <span className="inline-flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="font-display flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-emerald-400 text-lg font-bold text-[#062026]"
          >
            M
          </span>
          <span className={cn("font-display text-lg font-bold tracking-[0.18em]", tone === "dark" ? "text-[#f4f4f6]" : tone === "light" ? "text-[#0C160D]" : "text-[#0C160D] dark:text-[#f4f4f6]")}>
            {siteConfig.name}
          </span>
        </span>
      )}
    </Link>
  );
}
