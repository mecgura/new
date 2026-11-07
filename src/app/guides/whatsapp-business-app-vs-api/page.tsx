import type { Metadata } from "next";
import Link from "next/link";
import { Crumbs, FaqList, JsonLd, LeadSection, SeoFrame, faqLd } from "@/components/site/seo-blocks";
import { siteConfig } from "@/config/site";

const PATH = "/guides/whatsapp-business-app-vs-api";
export const metadata: Metadata = {
  title: "WhatsApp Business app vs WhatsApp Business API: which one do you need?",
  description: "A plain comparison of the free WhatsApp Business app and the WhatsApp Business API (Platform): features, limits, automation, team access and costs for Indian businesses.",
  alternates: { canonical: PATH },
  robots: { index: true, follow: true },
  openGraph: { type: "article", url: `${siteConfig.url}${PATH}`, title: "WhatsApp Business app vs API", siteName: "MECGURA" },
};

const ROWS: [string, string, string][] = [
  ["Cost", "Free to use", "No Meta fee for the platform itself. Meta charges per template message, and a provider such as MECGURA charges a monthly plan"],
  ["Who it is for", "A single owner or a very small team", "Growing businesses, teams and anyone who wants automation"],
  ["Team access", "One number on your phone plus a few linked devices", "A shared inbox with many agents on one number, with assignment and roles"],
  ["Automation", "Greeting, away message and quick replies", "Automated flows, buttons, chatbots and an AI assistant"],
  ["Sending to many customers", "Broadcast lists are small, and people must have saved your number", "Approved template campaigns to customers who opted in, with delivery reports"],
  ["CRM and integrations", "Labels and a catalogue", "Contacts, leads, tags, webhooks and integrations with other tools"],
  ["Setup", "Install the app and set up a profile", "Needs a provider to connect the number and get templates approved"],
];

const FAQS = [
  { q: "Can I use both on the same number?", a: "Often yes. Meta supports using the WhatsApp Business app and the Platform together on one number for eligible accounts (called coexistence). Ask your provider whether your number qualifies." },
  { q: "Will I lose my chats if I move to the API?", a: "Not necessarily. Your approach depends on how the number is connected. Ask your provider before you migrate, and keep a backup of important chats." },
  { q: "Is the API free?", a: "Connecting is not charged by Meta, but you pay Meta for template messages (marketing, utility, authentication) and a provider for the software. Replies within 24 hours of a customer's message are free." },
  { q: "Do I need the API if I only get a few enquiries?", a: "Probably not. If one person can answer everything and you don't need automation or a team inbox, the free app is enough." },
];

export default function Page() {
  return (
    <SeoFrame narrow crumbs={[{ name: "Guides", path: "/tools" }, { name: "App vs API", path: PATH }]}>
      <JsonLd data={faqLd(FAQS)} />
      <Crumbs items={[{ name: "Home", href: "/" }, { name: "App vs API" }]} />
      <h1 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">WhatsApp Business app vs WhatsApp Business API</h1>
      <p className="wa-muted mt-3">The free WhatsApp Business app is built for one person with a phone. The WhatsApp Business Platform (the &quot;API&quot;) is built for teams, automation and scale. Here is how to choose.</p>
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-small">
          <thead><tr className="border-b border-[var(--wa-line)]"><th className="py-3 pr-4">&nbsp;</th><th className="py-3 pr-4">WhatsApp Business app</th><th className="py-3">WhatsApp Business API</th></tr></thead>
          <tbody>{ROWS.map(([a, b, c]) => <tr key={a} className="border-b border-[var(--wa-line)] align-top"><th scope="row" className="py-3 pr-4 font-semibold">{a}</th><td className="py-3 pr-4">{b}</td><td className="py-3">{c}</td></tr>)}</tbody>
        </table>
      </div>
      <h2 className="mt-12 text-2xl font-bold">Which one should you choose?</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li><strong>Stay on the app</strong> if you are one person, get a few enquiries a day, and answer them yourself.</li>
        <li><strong>Move to the API</strong> if several people need the same number, enquiries arrive from ads, you want instant automatic replies, or you want to send offers to opted-in customers.</li>
        <li><strong>Not sure?</strong> Estimate your costs with the <Link href="/tools/whatsapp-message-cost-calculator" className="text-[#128c7e] underline">free calculator</Link> or read the <Link href="/guides/whatsapp-business-api-price-india" className="text-[#128c7e] underline">price guide</Link>.</li>
      </ul>
      <p className="wa-muted mt-6 text-small">Features and limits change from time to time. Check Meta&apos;s current documentation before you decide.</p>
      <FaqList faqs={FAQS} />
      <LeadSection page={PATH} />
    </SeoFrame>
  );
}
