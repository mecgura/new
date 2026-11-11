"use client";
import { useState } from "react";
import { Alert, Button, Field, Textarea, TextInput, EmailInput, PhoneInput } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

/** Public contact form. Posts to /api/public/contact; the clinic is decided server-side from the host. */
export function ContactForm({ disabled }: { disabled?: boolean }) {
  const [v, setV] = useState({ name: "", phone: "", email: "", message: "", consent: false, website_url: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setBusy(true); setMsg(undefined);
    const res = await apiFetch("/api/public/contact", { method: "POST", body: JSON.stringify(v) });
    setBusy(false);
    if (!res.ok) { setErrors(res.error.fieldErrors ?? {}); setMsg(res.error.fieldErrors ? undefined : res.error.message); return; }
    setErrors({}); setDone(true);
  }
  if (done) return <Alert tone="success" title="Message sent">Thank you. The clinic will get back to you using the details you gave. For anything urgent, please call the clinic directly.</Alert>;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-form">
      {disabled && <Alert tone="info">The form is switched off in preview.</Alert>}
      {msg && <Alert tone="danger">{msg}</Alert>}
      <Field label="Your name" required error={errors.name}><TextInput value={v.name} onChange={set("name")} autoComplete="name" maxLength={100} /></Field>
      <div className="grid gap-form sm:grid-cols-2">
        <Field label="Phone" error={errors.phone} hint="Phone or email is required"><PhoneInput value={v.phone} onChange={set("phone")} placeholder="" /></Field>
        <Field label="Email" error={errors.email}><EmailInput value={v.email} onChange={set("email")} /></Field>
      </div>
      <Field label="Message" required error={errors.message}><Textarea value={v.message} onChange={set("message")} maxLength={2000} rows={5} /></Field>
      {/* honeypot: hidden from people and assistive tech; bots fill it */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Leave this empty<input tabIndex={-1} autoComplete="off" value={v.website_url} onChange={set("website_url")} /></label></div>
      <div>
        <label className="flex items-start gap-3"><input type="checkbox" checked={v.consent} onChange={(e) => setV({ ...v, consent: e.target.checked })} className="mt-0.5 size-5 shrink-0 accent-[var(--brand-primary)]" aria-describedby="consent-help" />
          <span className="type-body">I agree that the clinic may contact me about my enquiry.</span></label>
        {errors.consent && <p role="alert" className="type-caption mt-1 !text-danger">{errors.consent}</p>}
        <p id="consent-help" className="type-caption mt-1">Please don&apos;t share medical details here. This form is not for emergencies.</p>
      </div>
      <Button type="submit" size="lg" loading={busy} disabled={disabled}>Send message</Button>
    </form>
  );
}
