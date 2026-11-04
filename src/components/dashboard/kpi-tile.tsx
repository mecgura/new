import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { groupIndian } from "@/lib/catalog";
import { cn } from "@/lib/utils";

/** Accent colours for the tile's icon chip and glow only — the number stays in text ink. */
const ACCENT = {
  emerald: "from-emerald-500/20 text-emerald-400 ring-emerald-500/25",
  sky: "from-sky-500/20 text-sky-400 ring-sky-500/25",
  violet: "from-violet-500/20 text-violet-400 ring-violet-500/25",
  amber: "from-amber-500/20 text-amber-400 ring-amber-500/25",
  pink: "from-pink-500/20 text-pink-400 ring-pink-500/25",
  orange: "from-orange-500/20 text-orange-400 ring-orange-500/25",
  teal: "from-teal-500/20 text-teal-400 ring-teal-500/25",
  indigo: "from-indigo-500/20 text-indigo-400 ring-indigo-500/25",
} as const;
export type Accent = keyof typeof ACCENT;

/** A clickable headline number that opens the page behind it. */
export function KpiTile({ href, label, value, hint, icon: Icon, accent }: { href: string; label: string; value: number; hint: string; icon: LucideIcon; accent: Accent }) {
  return (
    <Link href={href} className="group relative overflow-hidden rounded-2xl border border-app-border bg-app-surface p-4 transition hover:-translate-y-0.5 hover:border-app-primary/40 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-app-primary">
      <span className={cn("pointer-events-none absolute -right-6 -top-6 size-24 rounded-full bg-gradient-to-br to-transparent blur-xl", ACCENT[accent].split(" ")[0])} aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-2">
        <span className={cn("grid size-9 place-items-center rounded-xl bg-gradient-to-br to-transparent ring-1", ACCENT[accent])}><Icon className="size-4" aria-hidden="true" /></span>
        <ArrowUpRight className="size-4 text-app-subtle opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
      </div>
      <p className="relative mt-3 text-h2 font-semibold tabular-nums text-app-text">{groupIndian(value)}</p>
      <p className="relative text-small font-medium text-app-text">{label}</p>
      <p className="relative mt-0.5 truncate text-caption text-app-subtle">{hint}</p>
    </Link>
  );
}
