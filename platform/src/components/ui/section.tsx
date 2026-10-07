import { cn } from "@/lib/utils";

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  className,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-2xl",
        align === "center" ? "mx-auto text-center" : "text-left",
        className
      )}
    >
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand-600 dark:text-brand-400">{eyebrow}</p>
      <h2 className="font-display mt-3 text-3xl font-bold tracking-tight text-[#0C160D] dark:text-[#f4f4f6] sm:text-4xl">
        {title}
      </h2>
      {description ? <p className="mt-4 text-base font-medium leading-relaxed text-black dark:text-[#f4f4f6]">{description}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#CBD6CB] dark:border-[#2c2c3a] bg-[#F2F7F2] dark:bg-[#12121A] px-6 py-14 text-center">
      <p className="font-display text-lg font-semibold text-[#0C160D] dark:text-[#f4f4f6]">{title}</p>
      {description ? <p className="mt-2 max-w-sm text-sm text-black dark:text-[#f4f4f6]">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHero({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <section className="relative overflow-hidden border-b border-[#E6EEE6] dark:border-[#1c1c28]">
      <div className="hero-grid absolute inset-0" aria-hidden="true" />
      <div
        className="absolute -top-32 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-[120px]"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-5 pb-14 pt-16 sm:px-8 sm:pt-24">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand-600 dark:text-brand-400">{eyebrow}</p>
        <h1 className="font-display mt-4 max-w-3xl text-4xl font-bold tracking-tight text-[#0C160D] dark:text-[#f4f4f6] sm:text-5xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-5 max-w-2xl text-base font-medium leading-relaxed text-black dark:text-[#f4f4f6] sm:text-lg">{description}</p>
        ) : null}
      </div>
    </section>
  );
}
