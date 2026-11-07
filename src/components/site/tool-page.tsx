import Link from "next/link";
import { PublicShell } from "@/components/site/public-shell";
import { SiteTracker } from "@/components/marketing/site-tracker";
import { siteConfig } from "@/config/site";

export type ToolFaq = { q: string; a: string };
export const TOOLS = [
  { href: "/tools/whatsapp-link-generator", title: "WhatsApp link generator", blurb: "Make a wa.me link with a ready message. Put it on Instagram, Facebook, Google or your website." },
  { href: "/tools/whatsapp-qr-code-generator", title: "WhatsApp QR code generator", blurb: "Download a print-ready QR code that opens your WhatsApp chat. Shop boards, menus, visiting cards." },
  { href: "/tools/whatsapp-message-cost-calculator", title: "WhatsApp message cost calculator", blurb: "Estimate Meta’s monthly charges for marketing, utility and OTP messages before you start." },
] as const;

/** Shared frame for the free tools: heading, the tool, how-to text, FAQ (with Google structured data) and the other tools. */
export function ToolPage({ path, title, h1, intro, steps, faqs, children }: { path: string; title: string; h1: string; intro: string; steps: string[]; faqs: ToolFaq[]; children: React.ReactNode }) {
  const url = `${siteConfig.url}${path}`;
  const jsonLd = [
    { "@context": "https://schema.org", "@type": "WebApplication", name: title, url, applicationCategory: "BusinessApplication", operatingSystem: "Any", offers: { "@type": "Offer", price: "0", priceCurrency: "INR" }, publisher: { "@type": "Organization", name: "MECGURA", url: siteConfig.url } },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: siteConfig.url }, { "@type": "ListItem", position: 2, name: "Free tools", item: `${siteConfig.url}/tools` }, { "@type": "ListItem", position: 3, name: title, item: url }] },
  ];
  return (
    <PublicShell>
      <SiteTracker />
      {/* Structured data built from our own constants; "<" is escaped so nothing can close the script tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <nav aria-label="Breadcrumb" className="wa-muted text-small"><Link href="/" className="hover:underline">Home</Link> › <Link href="/tools" className="hover:underline">Free tools</Link></nav>
        <h1 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">{h1}</h1>
        <p className="wa-muted mt-3 max-w-2xl">{intro}</p>
        <div className="mt-8">{children}</div>
        <section className="mt-12" aria-labelledby="how-title">
          <h2 id="how-title" className="text-xl font-bold">How to use it</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
        </section>
        <section className="mt-12" aria-labelledby="faq-title">
          <h2 id="faq-title" className="text-xl font-bold">Questions</h2>
          <div className="mt-4 space-y-3">
            {faqs.map((f) => (
              <details key={f.q} className="wa-card px-5 py-4"><summary className="cursor-pointer list-none font-bold marker:hidden">{f.q}</summary><p className="wa-muted mt-2">{f.a}</p></details>
            ))}
          </div>
        </section>
        <section className="mt-12" aria-labelledby="more-title">
          <h2 id="more-title" className="text-xl font-bold">More free tools</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-3">
            {TOOLS.filter((t) => t.href !== path).map((t) => (
              <li key={t.href} className="wa-card p-4"><Link href={t.href} className="font-semibold hover:underline">{t.title}</Link><p className="wa-muted mt-1 text-small">{t.blurb}</p></li>
            ))}
          </ul>
        </section>
      </div>
    </PublicShell>
  );
}
