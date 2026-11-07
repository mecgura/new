import type { Metadata } from "next";
import { Crumbs, SeoFrame } from "@/components/site/seo-blocks";
import { LeadForm } from "@/components/site/lead-form";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Refer a business to MECGURA",
  description: "Know a business that loses customers on WhatsApp? Introduce them to MECGURA.",
  alternates: { canonical: "/refer" },
  robots: { index: true, follow: true },
};

export default function ReferPage() {
  const reward = siteConfig.referralReward;
  return (
    <SeoFrame crumbs={[{ name: "Refer a business", path: "/refer" }]} narrow>
      <Crumbs items={[{ name: "Home", href: "/" }, { name: "Refer a business" }]} />
      <h1 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">Know a business that needs WhatsApp automation?</h1>
      <p className="wa-muted mt-3">Introduce them to us. We&apos;ll contact them politely, mention that you suggested us, and look after them well.</p>
      <p className="mt-4 rounded-xl bg-[#e7f5ef] p-4">{reward ? <>Your thank-you: <strong>{reward}</strong> when they become a client.</> : <>If they become a client, we&apos;ll thank you personally. Ask us on WhatsApp what the current referral thank-you is.</>}</p>
      <ol className="mt-6 list-decimal space-y-2 pl-5"><li>Tell us who they are and how to reach them (only if they are happy to be contacted).</li><li>We reach out and explain how we can help.</li><li>We let you know when they join.</li></ol>
      <div className="mt-8"><LeadForm kind="referral" page="/refer" whatsapp={siteConfig.contact.whatsapp} title="Introduce a business" submitLabel="Send introduction" successTitle="Thank you for the introduction!" successHint="We'll reach out to them and keep you posted." showBusiness /></div>
    </SeoFrame>
  );
}
