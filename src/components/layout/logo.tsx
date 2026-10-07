"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

/**
 * Official MECGURA logo lives at `public/logo.png` (230x70, black background).
 * It sits in a dark rounded chip so it looks clean on the light theme.
 */
const LOGO_SRC = "/logo.png";

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <Link href={href} className={cn("group inline-flex items-center", className)} aria-label="MECGURA home">
      {!failed ? (
        <span className="inline-flex items-center rounded-xl bg-[#0A0A0F] px-3.5 py-2 shadow-sm ring-1 ring-black">
          <Image
            src={LOGO_SRC}
            alt="MECGURA logo"
            width={184}
            height={56}
            priority
            className="h-9 w-auto"
            onError={() => setFailed(true)}
          />
        </span>
      ) : (
        <span className="inline-flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="font-display flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-emerald-400 text-lg font-bold text-[#062026]"
          >
            M
          </span>
          <span className="font-display text-lg font-bold tracking-[0.18em] text-[#0C160D] dark:text-[#f4f4f6]">
            {siteConfig.name}
          </span>
        </span>
      )}
    </Link>
  );
}
