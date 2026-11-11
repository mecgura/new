import type { Metadata } from "next";
import Link from "next/link";
import { rupees } from "@/components/subscription/format";
import { publicPlans } from "@/lib/services/sub-plans";

export const metadata: Metadata = { title: "Plans & pricing — MECGURA HEALTH", description: "Plans and prices for MECGURA HEALTH, the clinic operating system." };
export const dynamic = "force-dynamic";

/** Public price list. Everything shown is read from the plan records the Super Admin manages — nothing is hard-coded here. */
export default async function PricingPage() {
  const plans = await publicPlans();
  return (
    <main id="main" className="mx-auto max-w-6xl px-page py-10">
      <h1 className="type-page-title">Plans &amp; pricing</h1>
      <p className="type-secondary mt-1">Prices in Indian rupees. Tax is added at checkout where applicable. Cancel any time — your data stays yours.</p>
      {!plans.length ? <p className="type-secondary mt-8" role="status">Our plans are being updated. Please contact us for current pricing.</p> : (
        <ul className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => (
            <li key={p.id} className="flex flex-col rounded-lg border border-line bg-surface p-card">
              <h2 className="type-card-title">{p.name}</h2>{p.description && <p className="type-secondary mt-1">{p.description}</p>}
              <p className="mt-3"><span className="text-2xl font-semibold">{p.monthlyPriceMinor === 0 ? "Free" : rupees(p.monthlyPriceMinor, p.currency)}</span>{p.monthlyPriceMinor > 0 && <span className="type-caption"> / month</span>}</p>
              {p.annualPriceMinor > 0 && <p className="type-secondary">or {rupees(p.annualPriceMinor, p.currency)} / year{p.annualSavingMinor > 0 ? ` (save ${rupees(p.annualSavingMinor)})` : ""}</p>}
              {p.trialDays > 0 && <p className="type-caption mt-1 !text-success">{p.trialDays}-day free trial</p>}
              {p.setupFeeMinor > 0 && <p className="type-caption">One-time setup fee {rupees(p.setupFeeMinor)}</p>}
              <ul className="type-secondary mt-3 space-y-1" aria-label={`${p.name} limits`}>{p.limitList.filter((l) => l.mode !== "UNLIMITED").map((l) => <li key={l.key}>{l.label}: {l.text}</li>)}</ul>
              <ul className="type-secondary mt-3 space-y-1" aria-label={`${p.name} features`}>{p.featureList.map((f) => <li key={f.key}><span aria-hidden>{f.included ? "✓" : "–"}</span> {f.label}<span className="sr-only">{f.included ? " included" : " not included"}</span></li>)}</ul>
              {p.supportLevel && <p className="type-caption mt-3">Support: {p.supportLevel}</p>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-8"><Link href="/login">Clinic sign in</Link> to choose a plan.</p>
    </main>
  );
}
