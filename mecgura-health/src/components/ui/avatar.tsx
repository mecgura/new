/* eslint-disable @next/next/no-img-element -- tenant logos/avatars are arbitrary user-supplied URLs; next/image needs a fixed domain allow-list (later phase). */
import { cn } from "@/lib/cn";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function Avatar({ name, src, size = "md", className }: { name: string; src?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const dim = { sm: "size-8 text-xs", md: "size-10 text-sm", lg: "size-14 text-lg" }[size];
  return (
    <span className={cn("inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-pill bg-primary-soft font-semibold text-primary", dim, className)} role="img" aria-label={name}>
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  );
}
