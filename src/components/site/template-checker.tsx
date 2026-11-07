"use client";

import * as React from "react";
import { checkTemplate } from "@/lib/template-check";

const field = "mt-1.5 w-full rounded-lg border border-[var(--wa-line)] bg-white px-3 py-2.5 text-[16px] outline-none focus:border-[#128c7e] focus:ring-2 focus:ring-[#128c7e]/20";
const LABEL = { MARKETING: ["Likely MARKETING", "bg-[#fff1e0] text-[#8a4b00]"], UTILITY: ["Likely UTILITY", "bg-[#e7f5ef] text-[#075e54]"], AUTHENTICATION: ["Likely AUTHENTICATION", "bg-[#e8eefc] text-[#1d3f9a]"], UNSURE: ["Not clear", "bg-[#f1f1f1] text-[#444]"] } as const;

/** Rule-based template check. Runs in the browser; the text is never sent anywhere. */
export function TemplateChecker({ whatsapp }: { whatsapp: string }) {
  const [text, setText] = React.useState("Hello {{1}}, your order #{{2}} is confirmed. We will update you when it is out for delivery.");
  const v = checkTemplate(text);
  const [label, tone] = LABEL[v.category];
  return (
    <div className="wa-card grid gap-6 p-6 md:grid-cols-2">
      <div>
        <label htmlFor="tc-text" className="text-small font-semibold">Your template text</label>
        <textarea id="tc-text" rows={9} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} className={field} />
        <p className="wa-muted mt-1 text-caption">Use {"{{1}}"}, {"{{2}}"} for the parts that change. Runs in your browser; nothing is sent to us.</p>
      </div>
      <div className="space-y-4" aria-live="polite">
        <p><span className={`inline-block rounded-full px-3 py-1 text-small font-bold ${tone}`} data-testid="category">{label}</span></p>
        <ul className="list-disc space-y-1 pl-5 text-small">{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        {v.warnings.length ? <div className="rounded-lg bg-[#fff7e6] p-3 text-small"><p className="font-semibold">Fix before you submit</p><ul className="mt-1 list-disc space-y-1 pl-5">{v.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div> : null}
        {v.ok.length ? <ul className="space-y-1 text-small text-[#075e54]">{v.ok.map((o) => <li key={o}>✓ {o}</li>)}</ul> : null}
        <p className="wa-muted text-caption">This is a rough guide. Meta decides the real category from what the message is for, and it re-categorises promotions written as utility. Never try to disguise a promotion.</p>
        <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent("Hi MECGURA, I need help getting my WhatsApp templates approved.")}`} data-track="tool_checker_cta" className="wa-btn !min-h-11 text-small">Get help with templates</a>
      </div>
    </div>
  );
}
