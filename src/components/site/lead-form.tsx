"use client";

import * as React from "react";
import { Check, MessageCircle } from "lucide-react";
import { apiFetch } from "@/lib/client-api";
import { getAttribution } from "@/components/marketing/site-tracker";
import { trackLead } from "@/lib/site-events";

type Kind = "demo" | "template_pack" | "referral";
const field = "mt-1.5 w-full rounded-lg border border-[var(--wa-line)] bg-white px-3 py-2.5 text-[16px] outline-none focus:border-[#128c7e] focus:ring-2 focus:ring-[#128c7e]/20";

/** One lead form for the whole site. The thank-you step opens a WhatsApp chat (free text is only allowed after the customer writes first). */
export function LeadForm({ kind = "demo", page, whatsapp, title, submitLabel = "Request free demo", successTitle = "Thank you! We'll call you soon.", successHint, downloadHref, defaultNeed = "demo", showBusiness = true }: {
  kind?: Kind;
  page: string;
  whatsapp: string;
  title?: string;
  submitLabel?: string;
  successTitle?: string;
  successHint?: string;
  downloadHref?: string;
  defaultNeed?: "demo" | "pricing" | "setup" | "ads" | "other";
  showBusiness?: boolean;
}) {
  const referral = kind === "referral";
  const [f, setF] = React.useState({ name: "", phone: "", business: "", city: "", need: defaultNeed, message: "", friendName: "", friendPhone: "", consent: false, company: "" });
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    const a = getAttribution();
    const r = await apiFetch("/api/site-lead", { method: "POST", body: { ...f, kind, page, medium: a?.medium ?? "", campaign: a?.campaign ?? "", ref: a?.ref ?? "" } });
    setBusy(false);
    if (!r.ok) return setErrors({ ...Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v[0]])), form: r.error });
    trackLead(kind);
    setDone(true);
  }

  if (done) {
    const text = referral ? `Hi MECGURA, I just introduced ${f.friendName || "a business"} to you.` : `Hi MECGURA, I'm ${f.name}${f.business ? ` from ${f.business}` : ""}. I just filled the form on your website.`;
    return (
      <div className="wa-card p-8 text-center" role="status">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-[#e7f5ef] text-[#128c7e]"><Check className="size-6" aria-hidden="true" /></span>
        <h3 className="mt-4 text-xl font-bold">{successTitle}</h3>
        <p className="wa-muted mt-2">{successHint ?? "Want a faster answer? Message us on WhatsApp now."}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {downloadHref ? <a href={downloadHref} download className="wa-btn" data-track="template_pack_download">Download the PDF</a> : null}
          <a href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(text)}`} data-track="form_whatsapp" className={`wa-btn ${downloadHref ? "wa-btn-ghost" : ""}`}><MessageCircle className="size-5" aria-hidden="true" /> Chat on WhatsApp</a>
        </div>
      </div>
    );
  }

  const err = (k: string) => (errors[k] ? <p role="alert" className="mt-1 text-caption text-red-700">{errors[k]}</p> : null);
  return (
    <form onSubmit={submit} className="wa-card space-y-4 p-6 sm:p-8" noValidate>
      {title ? <h3 className="text-xl font-bold">{title}</h3> : null}
      {referral ? <p className="wa-muted text-small">Your details</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor={`lf-name-${kind}`} className="text-small font-semibold">Your name</label><input id={`lf-name-${kind}`} autoComplete="name" value={f.name} onChange={set("name")} className={field} required />{err("name")}</div>
        <div><label htmlFor={`lf-phone-${kind}`} className="text-small font-semibold">Your mobile number</label><input id={`lf-phone-${kind}`} inputMode="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} placeholder="98765 43210" className={field} required />{err("phone")}</div>
      </div>
      {referral ? (
        <div className="grid gap-4 rounded-xl bg-[#f4f7f6] p-4 sm:grid-cols-2">
          <div><label htmlFor="lf-fname" className="text-small font-semibold">Their name</label><input id="lf-fname" value={f.friendName} onChange={set("friendName")} className={field} /></div>
          <div><label htmlFor="lf-fphone" className="text-small font-semibold">Their mobile number</label><input id="lf-fphone" inputMode="tel" value={f.friendPhone} onChange={set("friendPhone")} className={field} />{err("friendPhone")}</div>
          <div className="sm:col-span-2"><label htmlFor="lf-fbiz" className="text-small font-semibold">Their business</label><input id="lf-fbiz" value={f.business} onChange={set("business")} className={field} /></div>
        </div>
      ) : showBusiness ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor={`lf-biz-${kind}`} className="text-small font-semibold">Business name <span className="wa-muted font-normal">(optional)</span></label><input id={`lf-biz-${kind}`} autoComplete="organization" value={f.business} onChange={set("business")} className={field} /></div>
          <div><label htmlFor={`lf-city-${kind}`} className="text-small font-semibold">City <span className="wa-muted font-normal">(optional)</span></label><input id={`lf-city-${kind}`} value={f.city} onChange={set("city")} className={field} /></div>
        </div>
      ) : null}
      {kind === "demo" ? (
        <div>
          <label htmlFor="lf-need" className="text-small font-semibold">What do you need?</label>
          <select id="lf-need" value={f.need} onChange={set("need")} className={field}>
            <option value="demo">A free demo</option>
            <option value="pricing">Pricing</option>
            <option value="setup">Help with setup</option>
            <option value="ads">WhatsApp for my ads / leads</option>
            <option value="other">Something else</option>
          </select>
        </div>
      ) : null}
      {kind !== "template_pack" ? <div><label htmlFor={`lf-msg-${kind}`} className="text-small font-semibold">Anything we should know? <span className="wa-muted font-normal">(optional)</span></label><textarea id={`lf-msg-${kind}`} rows={2} maxLength={500} value={f.message} onChange={set("message")} className={field} /></div> : null}
      {/* Honeypot: hidden from people; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Company<input tabIndex={-1} autoComplete="off" value={f.company} onChange={set("company")} /></label></div>
      <label className="flex items-start gap-2.5 text-small">
        <input type="checkbox" checked={f.consent} onChange={set("consent")} className="mt-1 size-4 accent-[#128c7e]" />
        <span>I agree that MECGURA may contact me on WhatsApp, call or email about this. <a href="/privacy" className="text-[#128c7e] underline">Privacy policy</a></span>
      </label>
      {err("consent")}
      {errors.form && !Object.keys(errors).some((k) => k !== "form") ? <p role="alert" className="text-small text-red-700">{errors.form}</p> : null}
      <button type="submit" disabled={busy} data-track="lead_form_submit" className="wa-btn !min-h-12 w-full disabled:opacity-60">{busy ? "Sending…" : submitLabel}</button>
    </form>
  );
}
