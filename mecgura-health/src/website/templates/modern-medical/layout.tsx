import Link from "next/link";
import { Mail, MapPin, Phone } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { navigationFor } from "@/lib/website/pages";
import { withBase } from "@/lib/website/paths";
import { whatsappUrl } from "@/lib/website/urls";
import type { BaseProps } from "../types";
import { Btn, addressLines } from "./parts";
import { MobileMenu } from "./mobile-menu";

const SOCIAL: [keyof BaseProps["site"]["content"]["clinic"]["social"], string][] = [["facebook", "Facebook"], ["instagram", "Instagram"], ["youtube", "YouTube"], ["x", "X"], ["linkedin", "LinkedIn"]];

export function Layout({ site, basePath, children }: BaseProps & { children: React.ReactNode }) {
  const nav = navigationFor(site).map((n) => ({ label: n.label, href: withBase(basePath, n.path) }));
  const { identity: i, content: c } = site;
  const social = SOCIAL.filter(([k]) => c.clinic.social[k]);
  const wa = whatsappUrl(c.clinic.whatsapp || null);
  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink">
      <a href="#content" className="sr-only z-[70] rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      {i.isDemo && <p className="bg-warning-soft px-4 py-1.5 text-center text-sm text-warning"><strong>Demo website.</strong> Sample content only — not a real clinic.</p>}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="relative mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
          <Link href={withBase(basePath, "/")} aria-label={`${i.name} — home`} className="min-w-0 shrink no-underline"><Logo name={i.name} sub={null} logoUrl={site.logoUrl} className="[&_span]:!text-ink" /></Link>
          <nav aria-label="Main" className="ml-6 hidden flex-1 md:block">
            <ul className="flex flex-wrap items-center gap-1">
              {nav.map((n) => <li key={n.href}><Link href={n.href} className="inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium !text-ink no-underline hover:bg-surface-muted">{n.label}</Link></li>)}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Btn href={withBase(basePath, "/book-appointment")} className="min-h-10 px-3 text-sm sm:px-4"><span className="sm:hidden">Book</span><span className="hidden sm:inline">Book appointment</span></Btn>
            {wa ? <Btn href={wa} variant="whatsapp" external className="hidden min-h-10 px-4 text-sm lg:inline-flex">WhatsApp</Btn> : <Btn href={withBase(basePath, "/contact")} variant="outline" className="hidden min-h-10 px-4 text-sm lg:inline-flex">Contact</Btn>}
            <MobileMenu items={nav} />
          </div>
        </div>
      </header>

      <main id="content" tabIndex={-1} className="flex-1">{children}</main>

      <footer className="border-t border-line bg-surface-muted">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-3">
            <Logo name={i.name} sub={null} logoUrl={site.logoUrl} className="[&_span]:!text-ink" />
            {(c.footer.description) && <p className="text-sm text-muted">{c.footer.description}</p>}
            {social.length > 0 && <ul className="flex flex-wrap gap-3 text-sm">{social.map(([k, label]) => <li key={k}><a href={c.clinic.social[k]} target="_blank" rel="noopener noreferrer">{label}</a></li>)}</ul>}
          </div>
          <nav aria-label="Quick links"><h2 className="mb-3 text-sm font-semibold">Quick links</h2>
            <ul className="space-y-1.5 text-sm">{nav.map((n) => <li key={n.href}><Link href={n.href} className="!text-muted hover:underline">{n.label}</Link></li>)}</ul></nav>
          <div><h2 className="mb-3 text-sm font-semibold">Services</h2>
            <ul className="space-y-1.5 text-sm">{site.services.slice(0, 6).map((s) => <li key={s.slug}><Link href={withBase(basePath, `/services/${s.slug}`)} className="!text-muted hover:underline">{s.title}</Link></li>)}
              {site.services.length === 0 && <li className="text-muted">—</li>}</ul></div>
          <address className="space-y-2 text-sm not-italic"><h2 className="mb-3 text-sm font-semibold">Contact</h2>
            {addressLines(site).length > 0 && <p className="flex gap-2 text-muted"><MapPin aria-hidden className="mt-0.5 size-4 shrink-0" /><span>{addressLines(site).join(", ")}</span></p>}
            {i.phone && <p className="flex gap-2"><Phone aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" /><a href={`tel:${i.phone}`}>{i.phone}</a></p>}
            {i.email && <p className="flex gap-2"><Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" /><a href={`mailto:${i.email}`} className="break-all">{i.email}</a></p>}
          </address>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 text-sm text-muted sm:px-6">
            <p>© {new Date().getFullYear()} {i.legalName || i.name}. All rights reserved.</p>
            <ul className="flex flex-wrap gap-4">
              {c.legal.privacy && c.pages.privacy && <li><Link href={withBase(basePath, "/privacy")} className="!text-muted">Privacy</Link></li>}
              {c.legal.terms && c.pages.terms && <li><Link href={withBase(basePath, "/terms")} className="!text-muted">Terms</Link></li>}
              {site.attribution && <li>Website by MECGURA HEALTH</li>}
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
