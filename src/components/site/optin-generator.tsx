"use client";

import * as React from "react";
import { Copy } from "lucide-react";
import { optInTexts, type OptInInput } from "@/lib/template-check";

const field = "mt-1.5 w-full rounded-lg border border-[var(--wa-line)] bg-white px-3 py-2.5 text-[16px] outline-none focus:border-[#128c7e] focus:ring-2 focus:ring-[#128c7e]/20";

function CopyBlock({ title, text }: { title: string; text: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <div>
      <div className="flex items-center justify-between"><p className="text-small font-semibold">{title}</p>
        <button type="button" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }).catch(() => undefined); }} className="inline-flex items-center gap-1 text-small font-semibold text-[#128c7e]"><Copy className="size-4" aria-hidden="true" /> {done ? "Copied ✓" : "Copy"}</button>
      </div>
      <p className="mt-1.5 rounded-lg bg-[#f4f7f6] p-3 text-small">{text}</p>
    </div>
  );
}

/** Builds opt-in wording that says who you are, what you will send, how often, and how to stop. Runs in the browser. */
export function OptInGenerator({ whatsapp }: { whatsapp: string }) {
  const [f, setF] = React.useState<OptInInput>({ business: "", where: "counter", sends: ["offers", "reminders"], language: "hinglish", frequency: "" });
  const t = optInTexts(f);
  const toggle = (s: OptInInput["sends"][number]) => setF((x) => ({ ...x, sends: x.sends.includes(s) ? x.sends.filter((y) => y !== s) : [...x.sends, s] }));
  return (
    <div className="wa-card grid gap-6 p-6 md:grid-cols-2">
      <div className="space-y-4">
        <div><label htmlFor="oi-biz" className="text-small font-semibold">Business name</label><input id="oi-biz" value={f.business} maxLength={80} onChange={(e) => setF({ ...f, business: e.target.value })} placeholder="Glow Studio" className={field} /></div>
        <div><label htmlFor="oi-where" className="text-small font-semibold">Where will you ask?</label>
          <select id="oi-where" value={f.where} onChange={(e) => setF({ ...f, where: e.target.value as OptInInput["where"] })} className={field}>
            <option value="counter">At the shop / counter</option><option value="qr">QR code or poster</option><option value="website">Website or form</option><option value="ad_chat">In a chat from an ad</option>
          </select></div>
        <fieldset><legend className="text-small font-semibold">What will you send?</legend>
          <div className="mt-1.5 flex flex-wrap gap-4 text-small">{([["offers", "Offers"], ["orders", "Order updates"], ["reminders", "Reminders"]] as const).map(([k, n]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={f.sends.includes(k)} onChange={() => toggle(k)} className="size-4 accent-[#128c7e]" /> {n}</label>)}</div></fieldset>
        <div><label htmlFor="oi-lang" className="text-small font-semibold">Language</label>
          <select id="oi-lang" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as OptInInput["language"] })} className={field}><option value="hinglish">Hinglish</option><option value="english">English</option></select></div>
        <div><label htmlFor="oi-freq" className="text-small font-semibold">How often? <span className="wa-muted font-normal">(optional)</span></label><input id="oi-freq" value={f.frequency} maxLength={60} onChange={(e) => setF({ ...f, frequency: e.target.value })} placeholder="2-3 times a month" className={field} /></div>
      </div>
      <div className="space-y-4">
        <p className="wa-muted text-small">{t.where}</p>
        <CopyBlock title="Ask (message or script)" text={t.ask} />
        <CopyBlock title="Checkbox text for a form" text={t.checkbox} />
        <CopyBlock title="Reply after they agree" text={t.confirm} />
        <CopyBlock title="Line to add to every marketing message" text={t.stop} />
        <p className="wa-muted text-caption">Keep a record of when, where and how each customer agreed. Stop marketing to anyone who replies STOP.</p>
        <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent("Hi MECGURA, I want to collect WhatsApp opt-ins the right way.")}`} data-track="tool_optin_cta" className="wa-btn !min-h-11 text-small">Talk to MECGURA</a>
      </div>
    </div>
  );
}
