import type { Metadata } from "next";
import { Crumbs, FaqList, JsonLd, SeoFrame, faqLd } from "@/components/site/seo-blocks";
import { LeadForm } from "@/components/site/lead-form";
import { PACK_PDF, PACK_RULES, TEMPLATE_PACK } from "@/config/template-pack";
import { siteConfig } from "@/config/site";

const PATH = "/resources/whatsapp-message-templates";
export const metadata: Metadata = {
  title: "22 free WhatsApp Business message templates (copy and use)",
  description: "Ready-to-adapt WhatsApp Business templates for orders, appointments, payments, feedback and offers, with notes on marketing vs utility. Free PDF.",
  alternates: { canonical: PATH },
  robots: { index: true, follow: true },
  openGraph: { type: "article", url: `${siteConfig.url}${PATH}`, title: "Free WhatsApp message templates", siteName: "MECGURA" },
};

const tone = { UTILITY: "bg-[#e7f5ef] text-[#075e54]", MARKETING: "bg-[#fff1e0] text-[#8a4b00]", AUTHENTICATION: "bg-[#e8eefc] text-[#1d3f9a]" } as const;
const FAQS = [
  { q: "Do I need Meta's approval to use these?", a: "Yes. To message a customer first, WhatsApp requires an approved template. Submit the wording through your provider and wait for approval." },
  { q: "Why are some marked marketing and others utility?", a: "Meta groups templates by purpose. Updates about something the customer did are utility; promotions and offers are marketing, which costs more and needs opt-in." },
  { q: "Can I translate them into Hindi or Punjabi?", a: "Yes. Templates can be written in other languages. Each language version is approved separately." },
];

export default function Page() {
  return (
    <SeoFrame crumbs={[{ name: "Templates", path: PATH }]} narrow>
      <JsonLd data={faqLd(FAQS)} />
      <Crumbs items={[{ name: "Home", href: "/" }, { name: "Free WhatsApp templates" }]} />
      <h1 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">22 free WhatsApp Business message templates</h1>
      <p className="wa-muted mt-3">Copy the wording, change the details and submit it for approval. Each one is marked utility, marketing or authentication so you use it the right way.</p>
      <div className="mt-6 max-w-xl"><LeadForm kind="template_pack" page={PATH} whatsapp={siteConfig.contact.whatsapp} title="Get the PDF" submitLabel="Get the free PDF" successTitle="Your PDF is ready" successHint="Download it now. We may follow up to see if it helped." downloadHref={PACK_PDF} showBusiness={false} /></div>
      <h2 className="mt-12 text-2xl font-bold">Rules to follow</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">{PACK_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      <h2 className="mt-12 text-2xl font-bold">The templates</h2>
      <ul className="mt-5 space-y-4">
        {TEMPLATE_PACK.map((t) => (
          <li key={t.id} className="wa-card p-5">
            <p className="flex flex-wrap items-center gap-2"><span className="font-bold">{t.name}</span><span className={`rounded-full px-2.5 py-0.5 text-caption font-semibold ${tone[t.category]}`}>{t.category.toLowerCase()}</span></p>
            <p className="wa-muted mt-1 text-caption">{t.use}</p>
            <p className="mt-2 whitespace-pre-line rounded-lg bg-[#f4f7f6] p-3 text-small">{t.body}</p>
          </li>
        ))}
      </ul>
      <FaqList faqs={FAQS} />
    </SeoFrame>
  );
}
