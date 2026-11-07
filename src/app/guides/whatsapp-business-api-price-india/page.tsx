import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { Crumbs, FaqList, JsonLd, LeadSection, SeoFrame, faqLd } from "@/components/site/seo-blocks";
import { getMetaRates } from "@/services/meta-rates";
import { monthlyCost } from "@/lib/wa-link";
import { siteConfig } from "@/config/site";

export const revalidate = 3600;

const PATH = "/guides/whatsapp-business-api-price-india";
export const metadata: Metadata = {
  title: "WhatsApp Business API price in India: Meta charges and platform plans",
  description: "What the WhatsApp Business API really costs in India: Meta's per-message charges in rupees, free messages, and our platform plans. With worked examples.",
  alternates: { canonical: PATH },
  robots: { index: true, follow: true },
  openGraph: { type: "article", url: `${siteConfig.url}${PATH}`, title: "WhatsApp Business API price in India", siteName: "MECGURA" },
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: n < 100 ? 2 : 0, minimumFractionDigits: n < 100 && n % 1 ? 2 : 0 })}`;

export default async function Page() {
  const rates = await getMetaRates();
  const plans = await db.plan.findMany({ where: { isActive: true, priceMonthly: { gt: 0 } }, orderBy: { sortOrder: "asc" } }).catch(() => []);
  const scenarios = [
    { name: "Small shop", n: { marketing: 500, utility: 300, utilityFree: 100, authentication: 0 } },
    { name: "Growing business", n: { marketing: 3000, utility: 1500, utilityFree: 500, authentication: 200 } },
    { name: "High volume", n: { marketing: 15000, utility: 8000, utilityFree: 2000, authentication: 1000 } },
  ].map((s) => ({ ...s, c: monthlyCost(rates, s.n) }));
  const faqs = [
    { q: "How much does the WhatsApp Business API cost in India?", a: `You pay two things. Meta charges per template message sent: about ${inr(rates.marketing / 100)} for marketing, ${inr(rates.utility / 100)} for utility and ${inr(rates.authentication / 100)} for authentication (OTP) messages, before tax. And a provider charges a monthly plan for the software.` },
    { q: "Are replies free?", a: "Yes. When a customer messages you, you can reply freely for 24 hours. Utility templates sent in that window are also free." },
    { q: "Does MECGURA add a markup on Meta's charges?", a: "Meta bills your WhatsApp Business account directly. Our monthly plan is separate and shown on our homepage." },
    { q: "Can rates change?", a: "Yes. Meta updates its rate card from time to time. The numbers here are the ones we maintain, so check Meta's pricing page before you commit." },
  ];
  return (
    <SeoFrame narrow crumbs={[{ name: "Guides", path: "/tools" }, { name: "API price", path: PATH }]}>
      <JsonLd data={faqLd(faqs)} />
      <Crumbs items={[{ name: "Home", href: "/" }, { name: "WhatsApp API price in India" }]} />
      <h1 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">WhatsApp Business API price in India</h1>
      <p className="wa-muted mt-3">There are two costs: Meta&apos;s per-message charges, and the monthly plan for the platform that runs your inbox and automation. Here are both, in rupees.</p>

      <h2 className="mt-10 text-2xl font-bold">1. Meta&apos;s charges per message (before tax)</h2>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[420px] border-collapse text-left text-small"><thead><tr className="border-b border-[var(--wa-line)]"><th className="py-2 pr-4">Message type</th><th className="py-2 pr-4">Used for</th><th className="py-2">Per message</th></tr></thead><tbody>
        <tr className="border-b border-[var(--wa-line)]"><th scope="row" className="py-2 pr-4">Marketing</th><td className="py-2 pr-4">Offers, promotions, announcements</td><td className="py-2">{inr(rates.marketing / 100)}</td></tr>
        <tr className="border-b border-[var(--wa-line)]"><th scope="row" className="py-2 pr-4">Utility</th><td className="py-2 pr-4">Order, booking, payment and delivery updates</td><td className="py-2">{inr(rates.utility / 100)} (free inside the 24-hour window)</td></tr>
        <tr className="border-b border-[var(--wa-line)]"><th scope="row" className="py-2 pr-4">Authentication</th><td className="py-2 pr-4">OTP and login codes</td><td className="py-2">{inr(rates.authentication / 100)}</td></tr>
        <tr><th scope="row" className="py-2 pr-4">Replies to customers</th><td className="py-2 pr-4">Within 24 hours of their message</td><td className="py-2">Free</td></tr>
      </tbody></table></div>

      <h2 className="mt-10 text-2xl font-bold">2. Worked examples (Meta charges per month)</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {scenarios.map((s) => (
          <div key={s.name} className="wa-card p-5"><p className="font-bold">{s.name}</p><p className="wa-muted mt-1 text-caption">{s.n.marketing.toLocaleString("en-IN")} marketing · {s.n.utility.toLocaleString("en-IN")} utility ({s.n.utilityFree.toLocaleString("en-IN")} free) · {s.n.authentication.toLocaleString("en-IN")} OTP</p><p className="mt-3 font-display text-2xl font-bold text-[#075e54]">{inr(s.c.total)}</p></div>
        ))}
      </div>
      <p className="wa-muted mt-3 text-small">Estimates before tax. Try your own numbers in the <Link href="/tools/whatsapp-message-cost-calculator" className="text-[#128c7e] underline">cost calculator</Link>.</p>

      {plans.length ? (
        <>
          <h2 className="mt-10 text-2xl font-bold">3. MECGURA platform plans</h2>
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[480px] border-collapse text-left text-small"><thead><tr className="border-b border-[var(--wa-line)]"><th className="py-2 pr-4">Plan</th><th className="py-2 pr-4">Per month</th><th className="py-2 pr-4">Team members</th><th className="py-2">Messages / month</th></tr></thead><tbody>
            {plans.map((p) => <tr key={p.id} className="border-b border-[var(--wa-line)]"><th scope="row" className="py-2 pr-4">{p.name}</th><td className="py-2 pr-4">{p.priceMonthly >= 0 ? `${inr(p.priceMonthly / 100)}${p.selfServe ? "" : " onwards"}` : ""}</td><td className="py-2 pr-4">{p.maxUsers < 0 ? "Unlimited" : p.maxUsers}</td><td className="py-2">{p.maxMonthlyMessages < 0 ? "Unlimited" : p.maxMonthlyMessages.toLocaleString("en-IN")}</td></tr>)}
          </tbody></table></div>
          <p className="wa-muted mt-3 text-small">Plan prices are before tax. Offers and yearly discounts are shown on the <Link href="/#pricing" className="text-[#128c7e] underline">homepage</Link>.</p>
        </>
      ) : null}
      <FaqList faqs={faqs} />
      <LeadSection page={PATH} />
    </SeoFrame>
  );
}
