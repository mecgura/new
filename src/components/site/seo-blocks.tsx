import Link from "next/link";
import { PublicShell } from "@/components/site/public-shell";
import { SiteTracker } from "@/components/marketing/site-tracker";
import { LeadForm } from "@/components/site/lead-form";
import { siteConfig } from "@/config/site";
import type { Chat } from "@/config/seo-pages";

export type Faq = { q: string; a: string };

export function JsonLd({ data }: { data: unknown }) {
  // Built from our own constants; "<" is escaped so nothing can close the script tag.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export const faqLd = (faqs: Faq[]) => ({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
export const crumbLd = (items: { name: string; path: string }[]) => ({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((x, i) => ({ "@type": "ListItem", position: i + 1, name: x.name, item: `${siteConfig.url}${x.path}` })) });

export function Crumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="wa-muted text-small">
      {items.map((x, i) => (
        <span key={x.name}>{i ? " › " : ""}{x.href ? <Link href={x.href} className="hover:underline">{x.name}</Link> : x.name}</span>
      ))}
    </nav>
  );
}

export function ChatExample({ chat }: { chat: Chat[] }) {
  return (
    <figure className="mx-auto w-full max-w-sm rounded-2xl bg-[#efeae2] p-4 shadow-sm">
      <div className="space-y-2">
        {chat.map((m, i) => (
          <div key={i} className={`flex ${m.from === "customer" ? "justify-start" : "justify-end"}`}>
            <p className={`max-w-[85%] rounded-xl px-3 py-2 text-small ${m.from === "customer" ? "bg-white" : "bg-[#d9fdd3]"}`}>{m.text}</p>
          </div>
        ))}
      </div>
      <figcaption className="wa-muted mt-3 text-center text-caption">Example conversation (illustrative)</figcaption>
    </figure>
  );
}

export function FaqList({ faqs, title = "Questions" }: { faqs: Faq[]; title?: string }) {
  return (
    <section className="mt-14" aria-labelledby="faq-h">
      <h2 id="faq-h" className="text-2xl font-bold">{title}</h2>
      <div className="mt-4 space-y-3">
        {faqs.map((f) => (
          <details key={f.q} className="wa-card px-5 py-4"><summary className="cursor-pointer list-none font-bold marker:hidden">{f.q}</summary><p className="wa-muted mt-2">{f.a}</p></details>
        ))}
      </div>
    </section>
  );
}

export function LeadSection({ page, title = "Book a free demo", text = "Tell us a little about your business. We'll show you how it would work for you, in about 15 minutes." }: { page: string; title?: string; text?: string }) {
  return (
    <section className="mt-14" aria-labelledby="lead-h" id="demo">
      <h2 id="lead-h" className="text-2xl font-bold">{title}</h2>
      <p className="wa-muted mt-2 max-w-2xl">{text}</p>
      <div className="mt-5 max-w-2xl"><LeadForm page={page} whatsapp={siteConfig.contact.whatsapp} /></div>
    </section>
  );
}

/** Frame for the SEO pages: shell, tracker, breadcrumb schema. */
export function SeoFrame({ crumbs, children, narrow = false }: { crumbs: { name: string; path: string }[]; children: React.ReactNode; narrow?: boolean }) {
  return (
    <PublicShell>
      <SiteTracker />
      <JsonLd data={crumbLd([{ name: "Home", path: "/" }, ...crumbs])} />
      <div className={`mx-auto px-4 py-10 ${narrow ? "max-w-3xl" : "max-w-5xl"}`}>{children}</div>
    </PublicShell>
  );
}
