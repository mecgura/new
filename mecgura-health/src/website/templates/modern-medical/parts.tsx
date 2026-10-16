import Link from "next/link";
import { Activity, Baby, Bone, Brain, ClipboardList, Ear, Eye, HeartPulse, Microscope, Pill, ShieldCheck, Stethoscope, Syringe, Thermometer, Star, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { withBase } from "@/lib/website/paths";
import type { SiteData } from "@/lib/website/types";
import { mapsLink } from "@/lib/website/urls";

const ICONS: Record<string, LucideIcon> = { stethoscope: Stethoscope, "heart-pulse": HeartPulse, activity: Activity, pill: Pill, syringe: Syringe, baby: Baby, bone: Bone, brain: Brain, eye: Eye, ear: Ear, "shield-check": ShieldCheck, "clipboard-list": ClipboardList, microscope: Microscope, thermometer: Thermometer };
export const ServiceIcon = ({ name, className }: { name?: string | null; className?: string }) => { const I = (name && ICONS[name]) || Stethoscope; return <I aria-hidden className={className} />; };

export const Section = ({ id, title, intro, children, tone = "plain", className }: { id?: string; title?: string; intro?: string; children: React.ReactNode; tone?: "plain" | "soft"; className?: string }) => (
  <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className={cn("py-12 md:py-16", tone === "soft" && "bg-primary-soft/60", className)}>
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      {title && (
        <div className="mb-8 max-w-2xl">
          <h2 id={id ? `${id}-h` : undefined} className="text-2xl font-bold tracking-tight text-ink md:text-3xl">{title}</h2>
          {intro && <p className="mt-2 text-base text-muted">{intro}</p>}
        </div>
      )}
      {children}
    </div>
  </section>
);

export const PageHeading = ({ title, intro, crumbs }: { title: string; intro?: string; crumbs?: { label: string; href?: string }[] }) => (
  <div className="border-b border-line bg-primary-soft/50">
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 md:py-14">
      {crumbs && (
        <nav aria-label="Breadcrumb" className="mb-3"><ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          {crumbs.map((c, i) => <li key={c.label} className="flex items-center gap-1.5">{c.href ? <Link href={c.href} className="hover:underline">{c.label}</Link> : <span aria-current="page">{c.label}</span>}{i < crumbs.length - 1 && <span aria-hidden>/</span>}</li>)}
        </ol></nav>
      )}
      <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">{title}</h1>
      {intro && <p className="mt-3 max-w-2xl text-base text-muted md:text-lg">{intro}</p>}
    </div>
  </div>
);

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("rounded-card border border-line bg-surface p-5 shadow-card", className)} {...p} />;

/** Lazy, async-decoded image. Always has alt text from the CMS ("" = decorative). */
export const Img = ({ src, alt, className, priority }: { src: string; alt?: string | null; className?: string; priority?: boolean }) => (
  // eslint-disable-next-line @next/next/no-img-element -- images are re-encoded + downscaled at upload by our own /api/assets route
  <img src={src} alt={alt ?? ""} loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : undefined} className={className} />
);

export const Stars = ({ rating }: { rating: number }) => (
  <span role="img" aria-label={`Rated ${rating} out of 5`} className="inline-flex gap-0.5 text-warning">
    {[1, 2, 3, 4, 5].map((n) => <Star key={n} aria-hidden className={cn("size-4", n <= rating ? "fill-current" : "opacity-30")} />)}
  </span>
);

export const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export const Btn = ({ href, variant = "primary", children, external, className }: { href: string; variant?: "primary" | "outline" | "whatsapp"; children: React.ReactNode; external?: boolean; className?: string }) => {
  const cls = cn(
    "type-button inline-flex min-h-control items-center justify-center gap-2 whitespace-nowrap rounded-md px-5 no-underline transition-colors",
    variant === "primary" && "bg-btn !text-on-brand hover:bg-primary-hover",
    variant === "outline" && "border border-line-strong bg-surface !text-ink hover:bg-surface-muted",
    variant === "whatsapp" && "border border-success bg-success-soft !text-success hover:brightness-95",
    className,
  );
  return external ? <a href={href} className={cls} target="_blank" rel="noopener noreferrer">{children}</a> : <Link href={href} className={cls}>{children}</Link>;
};

/** Primary call-to-action row used in hero / CTA bands. Booking is not built yet: the page behind the button explains that. */
export function CtaRow({ site, base, align }: { site: SiteData; base: string; align?: "center" }) {
  return (
    <div className={cn("flex flex-wrap gap-3", align === "center" && "justify-center")}>
      <Btn href={withBase(base, "/book-appointment")}>{site.content.hero.primaryCtaLabel || "Book appointment"}</Btn>
      {site.whatsappLink ? <Btn href={site.whatsappLink} variant="whatsapp" external>WhatsApp</Btn> : site.identity.phone ? <Btn href={`tel:${site.identity.phone}`} variant="outline">Call {site.identity.phone}</Btn> : <Btn href={withBase(base, "/contact")} variant="outline">Contact clinic</Btn>}
    </div>
  );
}

export const addressLines = (s: SiteData) => [s.identity.address, [s.identity.city, s.identity.state, s.identity.pincode].filter(Boolean).join(", "), s.identity.country !== "India" ? s.identity.country : null].filter(Boolean) as string[];
export const mapHref = (s: SiteData) => s.content.clinic.mapUrl || mapsLink([s.identity.name, ...addressLines(s)]);
