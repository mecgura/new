import type { Metadata } from "next";
import Link from "next/link";
import { CITIES, INDUSTRIES } from "@/config/seo-pages";
import { Crumbs, SeoFrame } from "@/components/site/seo-blocks";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "WhatsApp automation for your business type and city",
  description: "How WhatsApp automation works for salons, restaurants, hotels, coaching institutes, clinics, real estate, shops and gyms in Punjab, Himachal and across India.",
  alternates: { canonical: "/whatsapp-automation" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: `${siteConfig.url}/whatsapp-automation`, title: "WhatsApp automation for your business", siteName: "MECGURA" },
};

export default function Hub() {
  return (
    <SeoFrame crumbs={[{ name: "WhatsApp automation", path: "/whatsapp-automation" }]}>
      <Crumbs items={[{ name: "Home", href: "/" }, { name: "WhatsApp automation" }]} />
      <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl">WhatsApp automation for your business</h1>
      <p className="wa-muted mt-3 max-w-2xl">Pick your business type to see what we set up, with an example conversation and answers to common questions.</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {INDUSTRIES.map((i) => (
          <li key={i.slug} className="wa-card p-5"><Link href={`/whatsapp-automation/${i.slug}`} className="font-bold hover:underline">{i.name}</Link><p className="wa-muted mt-1 text-small">{i.who}</p></li>
        ))}
      </ul>
      <h2 className="mt-12 text-2xl font-bold">By city</h2>
      <ul className="mt-4 flex flex-wrap gap-3">
        {CITIES.map((c) => <li key={c.slug}><Link href={`/whatsapp-automation/in/${c.slug}`} className="wa-pill !px-4 !py-2 text-small font-semibold hover:underline">{c.name}</Link></li>)}
      </ul>
    </SeoFrame>
  );
}
