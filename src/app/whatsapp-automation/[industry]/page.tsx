import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CITIES, INDUSTRIES, industryBySlug } from "@/config/seo-pages";
import { ChatExample, Crumbs, FaqList, JsonLd, LeadSection, SeoFrame, faqLd } from "@/components/site/seo-blocks";
import { siteConfig } from "@/config/site";

export const dynamicParams = false;
export function generateStaticParams() {
  return INDUSTRIES.map((i) => ({ industry: i.slug }));
}

type Props = { params: Promise<{ industry: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const i = industryBySlug((await params).industry);
  if (!i) return { robots: { index: false } };
  const path = `/whatsapp-automation/${i.slug}`;
  return {
    title: `${i.headline} | instant replies, bookings and follow-ups`,
    description: `${i.intro.slice(0, 150).trim()}…`,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: { type: "website", url: `${siteConfig.url}${path}`, title: i.headline, description: i.intro.slice(0, 200), siteName: "MECGURA" },
  };
}

export default async function IndustryPage({ params }: Props) {
  const i = industryBySlug((await params).industry);
  if (!i) notFound();
  const path = `/whatsapp-automation/${i.slug}`;
  return (
    <SeoFrame crumbs={[{ name: "WhatsApp automation", path: "/whatsapp-automation" }, { name: i.name, path }]}>
      <JsonLd data={{ "@context": "https://schema.org", "@type": "Service", name: i.headline, serviceType: "WhatsApp automation", provider: { "@type": "Organization", name: "MECGURA", url: siteConfig.url }, areaServed: "India", audience: { "@type": "Audience", audienceType: i.who } }} />
      <JsonLd data={faqLd(i.faqs)} />
      <Crumbs items={[{ name: "Home", href: "/" }, { name: "WhatsApp automation", href: "/whatsapp-automation" }, { name: i.name }]} />
      <div className="mt-3 grid items-start gap-10 lg:grid-cols-[1fr_340px]">
        <div>
          <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">{i.headline}</h1>
          <p className="wa-muted mt-3 max-w-2xl">{i.intro}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="#demo" data-track="seo_demo_cta" className="wa-btn">Book a free demo</a>
            <a href={`https://wa.me/${siteConfig.contact.whatsapp}?text=${encodeURIComponent(`Hi MECGURA, I run a ${i.name.toLowerCase()} business and want WhatsApp automation.`)}`} data-track="seo_whatsapp_cta" className="wa-btn wa-btn-ghost">Talk on WhatsApp</a>
          </div>
        </div>
        <ChatExample chat={i.chat} />
      </div>

      <section className="mt-14" aria-labelledby="prob-h">
        <h2 id="prob-h" className="text-2xl font-bold">Problems we fix for {i.who}</h2>
        <ul className="mt-5 grid gap-4 md:grid-cols-2">
          {i.problems.map((p) => (
            <li key={p.problem} className="wa-card p-5"><p className="font-bold">{p.problem}</p><p className="wa-muted mt-2 text-small">{p.fix}</p></li>
          ))}
        </ul>
      </section>

      <section className="mt-14" aria-labelledby="setup-h">
        <h2 id="setup-h" className="text-2xl font-bold">What we set up for you</h2>
        <ul className="mt-4 list-disc space-y-2 pl-5">{i.setup.map((s) => <li key={s}>{s}</li>)}</ul>
        <p className="wa-muted mt-4 text-small">Our team does the setup, usually in about a day on your existing business number. Plans and pricing are on the <Link href="/#pricing" className="text-[#128c7e] underline">homepage</Link>; Meta&apos;s WhatsApp charges are billed by Meta separately. Estimate them with the <Link href="/tools/whatsapp-message-cost-calculator" className="text-[#128c7e] underline">free cost calculator</Link>.</p>
      </section>

      <FaqList faqs={i.faqs} />
      <LeadSection page={path} />

      <section className="mt-14" aria-labelledby="near-h">
        <h2 id="near-h" className="text-xl font-bold">We work with businesses in</h2>
        <ul className="mt-3 flex flex-wrap gap-3">{CITIES.map((c) => <li key={c.slug}><Link href={`/whatsapp-automation/in/${c.slug}`} className="wa-pill !px-4 !py-2 text-small font-semibold hover:underline">{c.name}</Link></li>)}</ul>
      </section>
    </SeoFrame>
  );
}
