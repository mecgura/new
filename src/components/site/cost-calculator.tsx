"use client";

import * as React from "react";
import { monthlyCost } from "@/lib/wa-link";

type Rates = { marketing: number; utility: number; authentication: number };
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: n < 100 ? 2 : 0, minimumFractionDigits: n < 100 && n % 1 ? 2 : 0 })}`;
const field = "mt-1.5 w-full rounded-lg border border-[var(--wa-line)] bg-white px-3 py-2.5 text-[16px] outline-none focus:border-[#128c7e] focus:ring-2 focus:ring-[#128c7e]/20";
const num = (v: string) => Math.min(10_000_000, Math.max(0, Math.floor(Number(v.replace(/\D/g, "")) || 0)));

/** Estimate of Meta's monthly WhatsApp template charges. Rates come from MECGURA's maintained rate card; Meta bills you directly. */
export function CostCalculator({ rates, whatsapp }: { rates: Rates; whatsapp: string }) {
  const [v, setV] = React.useState({ marketing: "1000", utility: "500", utilityFree: "0", authentication: "0" });
  const n = { marketing: num(v.marketing), utility: num(v.utility), utilityFree: num(v.utilityFree), authentication: num(v.authentication) };
  const c = monthlyCost(rates, n);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const rows: { k: keyof typeof v; label: string; hint: string }[] = [
    { k: "marketing", label: "Marketing messages / month", hint: `Offers, promotions, festival wishes with an offer. ${inr(rates.marketing / 100)} each.` },
    { k: "utility", label: "Utility messages / month", hint: `Order, booking, payment and delivery updates. ${inr(rates.utility / 100)} each.` },
    { k: "utilityFree", label: "…of those sent inside the customer’s 24-hour window", hint: "Utility templates sent within 24 hours of the customer’s last message are free." },
    { k: "authentication", label: "Authentication (OTP) messages / month", hint: `Login and verification codes. ${inr(rates.authentication / 100)} each.` },
  ];
  return (
    <div className="wa-card grid gap-6 p-6 md:grid-cols-2">
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.k}>
            <label htmlFor={`c-${r.k}`} className="text-small font-semibold">{r.label}</label>
            <input id={`c-${r.k}`} inputMode="numeric" value={v[r.k]} onChange={set(r.k)} className={field} />
            <p className="wa-muted mt-1 text-caption">{r.hint}</p>
          </div>
        ))}
      </div>
      <div className="space-y-4" aria-live="polite">
        <div className="rounded-xl bg-[#e7f5ef] p-5">
          <p className="text-small font-semibold text-[#075e54]">Estimated Meta charges per month</p>
          <p className="mt-1 font-display text-4xl font-bold text-[#075e54]" data-testid="total">{inr(c.total)}</p>
          <p className="wa-muted mt-1 text-caption">{c.perMessage ? `About ${inr(c.perMessage)} per message on average. ` : ""}Before GST. Replies to customers within 24 hours are free.</p>
        </div>
        <dl className="space-y-2 text-small">
          <div className="flex justify-between"><dt>Marketing ({n.marketing.toLocaleString("en-IN")})</dt><dd className="font-semibold tabular-nums">{inr(c.marketing)}</dd></div>
          <div className="flex justify-between"><dt>Utility ({c.utilityPaid.toLocaleString("en-IN")} paid)</dt><dd className="font-semibold tabular-nums">{inr(c.utility)}</dd></div>
          <div className="flex justify-between"><dt>Authentication ({n.authentication.toLocaleString("en-IN")})</dt><dd className="font-semibold tabular-nums">{inr(c.authentication)}</dd></div>
        </dl>
        {n.marketing > 0 && c.marketing > c.total * 0.7 ? (
          <p className="rounded-lg bg-[#fff7e6] p-3 text-small">Most of your cost is marketing. Use marketing templates only for real promotions. Order, booking and payment updates belong in utility, which costs much less. Don’t label a promotion as utility: Meta re-categorises it and can restrict your number.</p>
        ) : null}
        <p className="wa-muted text-caption">An estimate using Meta’s India rate card as maintained by MECGURA. Meta can change its rates, and Meta bills your WhatsApp Business account directly. Check Meta’s current pricing before you commit.</p>
        <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hi MECGURA, my WhatsApp estimate is about ${inr(c.total)}/month. Can you help me set it up?`)}`} data-track="tool_calc_cta" className="wa-btn !min-h-11 text-small">Get this set up with MECGURA</a>
      </div>
    </div>
  );
}
