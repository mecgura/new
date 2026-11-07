import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CITIES, INDUSTRIES, cityBySlug } from "@/config/seo-pages";
import { Crumbs, FaqList, JsonLd, LeadSection, SeoFrame, faqLd } from "@/components/site/seo-blocks";
import { siteConfig } from "@/config/site";

export const dynamicParams = false;
export function generateStaticParams() {
  return CITIES.map((c) => ({ city: c.slug }));
}

type Props = { params: Promise<{ city: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = cityBySlug((await params).city);
  if (!c) return { robots: { index: false } };
  const path = `/whatsapp-automation/in/${c.slug}`;
  return {
    title: `WhatsApp automation for businesses in ${c.name}`,
    description: `Instant WhatsApp replies, bookings and follow-ups for ${c.name} businesses: shops, clinics, coaching centres, hotels, restaurants and more. Set up by MECGURA.`,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: { type: "website", url: `${siteConfig.url}${path}`, title: `WhatsApp automation in ${c.name}`, siteName: "MECGURA" },
  };
}

export default async function CityPage({ params }: Props) {
  const c = cityBySlug((await params).city);
  if (!c) notFound();
  const path = `/whatsapp-automation/in/${c.slug}`;
  const faqs = [
    { q: `Do you work with businesses in ${c.name}?`, a: `Yes. We set up WhatsApp automation for businesses in ${c.name} and across India. Setup is done over a call and WhatsApp, so you don't need to visit an office.` },
    { q: "How long does setup take?", a: "Usually about a day on your existing business number, once your details are ready." },
    { q: "What does it cost?", a: "Plans are listed on the homepage. Meta's per-message WhatsApp charges are billed by Meta separately, and you can estimate them with our free calculator." },
    { q: "Can replies be in Hindi or Punjabi?", a: "Yes. Messages can be written in Hinglish or any language you choose, and customers who prefer another language can be handed to your team." },
  ];
  return (
    <SeoFrame crumbs={[{ name: "WhatsApp automation", path: "/whatsapp-automation" }, { name: c.name, path }]}>
      <JsonLd data={faqLd(faqs)} />
      <Crumbs items={[{ name: "Home", href: "/" }, { name: "WhatsApp automation", href: "/whatsapp-automation" }, { name: c.name }]} />
      <h1 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">WhatsApp automation for businesses in {c.name}</h1>
      <p className="wa-muted mt-3 max-w-2xl">{c.intro} MECGURA sets up instant replies, bookings, lead follow-ups and an inbox for your whole team.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a href="#demo" data-track="seo_demo_cta" className="wa-btn">Book a free demo</a>
        <a href={`https://wa.me/${siteConfig.contact.whatsapp}?text=${encodeURIComponent(`Hi MECGURA, I have a business in ${c.name} and want WhatsApp automation.`)}`} data-track="seo_whatsapp_cta" className="wa-btn wa-btn-ghost">Talk on WhatsApp</a>
      </div>
      <section className="mt-14">
        <h2 className="text-2xl font-bold">Businesses in {c.name} we help</h2>
        <ul className="mt-4 list-disc space-y-1 pl-5">{c.businesses.map((b) => <li key={b}>{b}</li>)}</ul>
      </section>
      <section className="mt-14">
        <h2 className="text-2xl font-bold">See how it works for your business type</h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {INDUSTRIES.map((i) => <li key={i.slug} className="wa-card p-4"><Link href={`/whatsapp-automation/${i.slug}`} className="font-bold hover:underline">{i.name}</Link></li>)}
        </ul>
      </section>
      <FaqList faqs={faqs} />
      <LeadSection page={path} />
    </SeoFrame>
  );
}
