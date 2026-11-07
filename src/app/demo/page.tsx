import type { Metadata } from "next";
import { Crumbs, JsonLd, SeoFrame, faqLd } from "@/components/site/seo-blocks";
import { LeadForm } from "@/components/site/lead-form";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Book a free WhatsApp automation demo",
  description: "See how instant WhatsApp replies, bookings and lead follow-ups would work for your business. Free 15-minute demo with the MECGURA team.",
  alternates: { canonical: "/demo" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: `${siteConfig.url}/demo`, title: "Book a free demo | MECGURA", siteName: "MECGURA" },
};

const FAQS = [
  { q: "What happens in the demo?", a: "We look at how customers contact you today, then show how instant replies, buttons, brochures, bookings and lead follow-ups would work for your business." },
  { q: "Is the demo free?", a: "Yes. There is no charge and no obligation." },
  { q: "How soon will you contact me?", a: "We reply as soon as we can, usually within a working day. You can also message us on WhatsApp for a faster answer." },
];

export default function DemoPage() {
  return (
    <SeoFrame crumbs={[{ name: "Free demo", path: "/demo" }]}>
      <JsonLd data={faqLd(FAQS)} />
      <Crumbs items={[{ name: "Home", href: "/" }, { name: "Free demo" }]} />
      <div className="mt-3 grid items-start gap-10 lg:grid-cols-[1fr_420px]">
        <div>
          <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">Book a free demo</h1>
          <p className="wa-muted mt-3 max-w-xl">15 minutes. We show you how WhatsApp automation would work for your business: instant replies, buttons, brochures, bookings and a shared inbox for your team.</p>
          <ul className="mt-6 space-y-3">
            {["Usually set up on your existing business number", "Our team does the setup", "No obligation"].map((x) => <li key={x} className="flex gap-2"><span aria-hidden="true" className="text-[#128c7e]">✓</span>{x}</li>)}
          </ul>
          <div className="mt-8 space-y-3">{FAQS.map((f) => <details key={f.q} className="wa-card px-5 py-4"><summary className="cursor-pointer list-none font-bold marker:hidden">{f.q}</summary><p className="wa-muted mt-2">{f.a}</p></details>)}</div>
        </div>
        <LeadForm page="/demo" whatsapp={siteConfig.contact.whatsapp} title="Tell us about your business" />
      </div>
    </SeoFrame>
  );
}
