import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { siteConfig } from "@/config/site";
import { SiteAnalytics } from "@/components/site/analytics";

/** Header + footer for public pages outside the homepage (blog). Same look as the homepage. */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="wa-root min-h-dvh overflow-x-hidden">
      <SiteAnalytics />
      <header className="wa-topbar sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Logo tone="light" />
          <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
            <Link href="/" className="wa-muted hidden px-3 py-2 text-small font-semibold hover:text-[var(--wa-ink)] sm:inline">Home</Link>
            <Link href="/blog" className="wa-muted px-3 py-2 text-small font-semibold hover:text-[var(--wa-ink)]">Blog</Link>
            <Link href="/tools" className="wa-muted px-3 py-2 text-small font-semibold hover:text-[var(--wa-ink)]">Free tools</Link>
            <Link href="/#pricing" className="wa-muted hidden px-3 py-2 text-small font-semibold hover:text-[var(--wa-ink)] sm:inline">Pricing</Link>
            <Link href="/demo" className="wa-btn !min-h-10 !px-5 text-small" data-track="header_demo">Free demo</Link>
          </nav>
        </div>
      </header>
      <main id="main-content">{children}</main>
      <footer className="border-t border-[var(--wa-line)] bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-small">
          <p className="wa-muted">© {new Date().getFullYear()} MECGURA · <a href={`mailto:${siteConfig.contact.email}`} className="hover:underline">{siteConfig.contact.email}</a></p>
          <nav aria-label="Footer" className="flex flex-wrap gap-5 font-semibold">
            <Link href="/" className="hover:underline">Home</Link>
            <Link href="/blog" className="hover:underline">Blog</Link>
            <Link href="/tools" className="hover:underline">Free tools</Link>
            <Link href="/whatsapp-automation" className="hover:underline">By industry</Link>
            <Link href="/about" className="hover:underline">About</Link>
            <Link href="/refer" className="hover:underline">Refer</Link>
            <Link href="/privacy" className="hover:underline">Privacy</Link>
            <Link href="/terms" className="hover:underline">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
