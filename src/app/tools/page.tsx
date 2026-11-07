import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/site/public-shell";
import { SiteTracker } from "@/components/marketing/site-tracker";
import { TOOLS } from "@/components/site/tool-page";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Free WhatsApp tools for businesses: link, QR code and cost calculator",
  description: "Free tools for Indian businesses: WhatsApp link generator, WhatsApp QR code generator and a WhatsApp message cost calculator. No sign-up. Private: runs in your browser.",
  alternates: { canonical: "/tools" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: `${siteConfig.url}/tools`, title: "Free WhatsApp tools | MECGURA", description: "WhatsApp link and QR code generator, and a message cost calculator. Free, no sign-up.", siteName: "MECGURA" },
};

export default function ToolsHub() {
  return (
    <PublicShell>
      <SiteTracker />
      <section className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">Free WhatsApp tools</h1>
        <p className="wa-muted mt-3 max-w-2xl">Simple tools we use ourselves. No sign-up, nothing to install, and nothing you type is sent to us.</p>
        <ul className="mt-8 grid gap-5 md:grid-cols-3">
          {TOOLS.map((t) => (
            <li key={t.href} className="wa-card flex flex-col p-6">
              <h2 className="text-lg font-bold leading-snug"><Link href={t.href} className="hover:underline">{t.title}</Link></h2>
              <p className="wa-muted mt-2 flex-1 text-small">{t.blurb}</p>
              <Link href={t.href} className="mt-4 text-small font-semibold text-[#128c7e] hover:underline">Open the tool →</Link>
            </li>
          ))}
        </ul>
      </section>
    </PublicShell>
  );
}
