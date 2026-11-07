import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedResults } from "@/services/site/results";
import { Crumbs, LeadSection, SeoFrame } from "@/components/site/seo-blocks";
import { siteConfig } from "@/config/site";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Client results: WhatsApp automation case studies",
  description: "Real results from businesses using MECGURA's WhatsApp automation, in their own words and numbers.",
  alternates: { canonical: "/results" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", url: `${siteConfig.url}/results`, title: "MECGURA client results", siteName: "MECGURA" },
};

export default async function ResultsPage() {
  const items = await getPublishedResults();
  if (!items.length) notFound();
  return (
    <SeoFrame crumbs={[{ name: "Results", path: "/results" }]}>
      <Crumbs items={[{ name: "Home", href: "/" }, { name: "Results" }]} />
      <h1 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Client results</h1>
      <p className="wa-muted mt-3 max-w-2xl">What changed for businesses after we set up WhatsApp automation. Shown with each client&apos;s permission.</p>
      <ul className="mt-8 space-y-5">
        {items.map((c) => (
          <li key={c.id} className="wa-card p-6">
            <p className="wa-muted text-caption">{[c.type, c.city].filter(Boolean).join(" · ")}</p>
            <h2 className="mt-1 text-xl font-bold">{c.business}</h2>
            <p className="mt-3"><span className="font-semibold">The problem: </span>{c.challenge}</p>
            <p className="mt-2"><span className="font-semibold">What we set up: </span>{c.solution}</p>
            {c.results.length ? (
              <dl className="mt-4 grid gap-3 sm:grid-cols-4">
                {c.results.map((r) => <div key={r.label} className="rounded-xl bg-[#e7f5ef] p-4"><dd className="font-display text-2xl font-bold text-[#075e54]">{r.value}</dd><dt className="wa-muted text-small">{r.label}</dt></div>)}
              </dl>
            ) : null}
            {c.quote ? <blockquote className="mt-4 border-l-4 border-[#128c7e] pl-4 italic">“{c.quote}”<footer className="wa-muted mt-1 text-small not-italic">{c.quoteBy}</footer></blockquote> : null}
          </li>
        ))}
      </ul>
      <LeadSection page="/results" title="Want results like these?" />
    </SeoFrame>
  );
}
