import type { Metadata } from "next";
import { Crumbs, JsonLd, LeadSection, SeoFrame } from "@/components/site/seo-blocks";
import { getHomeContent } from "@/services/site/home-content";
import { siteConfig } from "@/config/site";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "About MECGURA",
  description: "MECGURA sets up WhatsApp automation, a shared team inbox, CRM and AI assistants for businesses in India. Meet the team and see how we work.",
  alternates: { canonical: "/about" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: `${siteConfig.url}/about`, title: "About MECGURA", siteName: "MECGURA" },
};

export default async function AboutPage() {
  const content = await getHomeContent().catch(() => null);
  const team = content?.team ?? [];
  return (
    <SeoFrame crumbs={[{ name: "About", path: "/about" }]}>
      <JsonLd data={{ "@context": "https://schema.org", "@type": "AboutPage", name: "About MECGURA", url: `${siteConfig.url}/about`, mainEntity: { "@type": "Organization", name: "MECGURA", url: siteConfig.url, email: siteConfig.contact.email, telephone: `+${siteConfig.contact.whatsapp}` } }} />
      <Crumbs items={[{ name: "Home", href: "/" }, { name: "About" }]} />
      <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl">About MECGURA</h1>
      <p className="wa-muted mt-3 max-w-2xl">We help businesses in India answer every customer on WhatsApp quickly: instant replies, booking and enquiry flows, a shared inbox for the team, a simple CRM and an AI assistant. We do the setup, and we stay reachable after.</p>
      <section className="mt-12"><h2 className="text-2xl font-bold">How we work</h2>
        <ul className="mt-4 grid gap-4 md:grid-cols-3">
          {[["Set up for you", "Our team configures replies, flows and templates. Usually about a day on your existing number."], ["Permission first", "We message only customers who agreed to hear from you. That keeps your WhatsApp number healthy."], ["Honest pricing", "Our plans are on the homepage. Meta's per-message charges are billed by Meta, and we show how to estimate them."]].map(([t, d]) => <li key={t} className="wa-card p-5"><p className="font-bold">{t}</p><p className="wa-muted mt-2 text-small">{d}</p></li>)}
        </ul>
      </section>
      {team.length ? (
        <section className="mt-12"><h2 className="text-2xl font-bold">The team</h2>
          <ul className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {team.map((m) => (
              <li key={m.id} className="wa-card flex gap-4 p-5">
                {m.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.photo} alt={m.name} className="size-16 shrink-0 rounded-full object-cover" />
                ) : null}
                <div><p className="font-bold">{m.name}</p>{m.role ? <p className="wa-muted text-small">{m.role}</p> : null}{m.bio ? <p className="mt-1 text-small">{m.bio}</p> : null}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="mt-12"><h2 className="text-2xl font-bold">Contact</h2>
        <p className="mt-3">WhatsApp: <a className="text-[#128c7e] underline" href={`https://wa.me/${siteConfig.contact.whatsapp}`}>+{siteConfig.contact.whatsapp.replace(/^91(\d{5})(\d{5})$/, "91 $1 $2")}</a><br />Email: <a className="text-[#128c7e] underline" href={`mailto:${siteConfig.contact.email}`}>{siteConfig.contact.email}</a></p>
      </section>
      <LeadSection page="/about" />
    </SeoFrame>
  );
}
