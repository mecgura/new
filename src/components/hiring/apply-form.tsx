"use client";

import * as React from "react";
import { CheckCircle2, Upload } from "lucide-react";

/** Public job application form (no login). */
export function ApplyForm({ orgSlug, jobSlug, title }: { orgSlug: string; jobSlug: string; title: string }) {
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<null | { duplicate: boolean }>(null);
  const [fileName, setFileName] = React.useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError("");
    try {
      const res = await fetch(`/api/careers/${orgSlug}/${jobSlug}/apply`, { method: "POST", body: new FormData(e.currentTarget) });
      const j = (await res.json().catch(() => ({}))) as { error?: string; details?: Record<string, string[]>; duplicate?: boolean };
      if (!res.ok) {
        setErrors(Object.fromEntries(Object.entries(j.details ?? {}).map(([k, v]) => [k, v[0]])));
        setError(j.error ?? "Could not send your application.");
        return;
      }
      setDone({ duplicate: Boolean(j.duplicate) });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="wa-card p-6 text-center">
        <CheckCircle2 className="mx-auto size-10 text-[#128c7e]" aria-hidden="true" />
        <h2 className="mt-3 text-xl font-bold">{done.duplicate ? "You have already applied" : "Application sent!"}</h2>
        <p className="wa-muted mt-2 text-sm">Thank you for applying for {title}. The team will contact you on WhatsApp or phone if you are shortlisted.</p>
      </div>
    );
  }

  const input = "mt-1 w-full rounded-xl border border-[var(--wa-line)] bg-white px-3 py-2.5 text-[15px] outline-none focus:border-[var(--wa-teal-2)]";
  const err = (k: string) => (errors[k] ? <p role="alert" className="mt-1 text-xs text-red-600">{errors[k]}</p> : null);
  return (
    <form onSubmit={submit} noValidate className="wa-card space-y-4 p-6">
      <h2 className="text-xl font-bold">Apply for this job</h2>
      <label className="block text-sm font-semibold">Full name<input name="name" required autoComplete="name" className={input} />{err("name")}</label>
      <label className="block text-sm font-semibold">Mobile (WhatsApp)<input name="phone" type="tel" required autoComplete="tel" placeholder="98765 43210" className={input} />{err("phone")}</label>
      <label className="block text-sm font-semibold">Email (optional)<input name="email" type="email" autoComplete="email" className={input} />{err("email")}</label>
      <label className="block text-sm font-semibold">Experience (optional)<input name="experience" placeholder="e.g. 2 years in sales" className={input} />{err("experience")}</label>
      <label className="block cursor-pointer text-sm font-semibold">
        Resume (optional)
        <span className={`${input} flex items-center gap-2 text-[var(--wa-muted)]`}><Upload className="size-4" aria-hidden="true" /> {fileName || "PDF, Word or photo, up to 4 MB"}</span>
        <input name="resume" type="file" accept=".pdf,.doc,.docx,image/jpeg,image/png" className="sr-only" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} />
        {err("resume")}
      </label>
      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <button type="submit" disabled={busy} className="wa-btn w-full disabled:opacity-60">{busy ? "Sending…" : "Submit application"}</button>
      <p className="wa-muted text-xs">By applying you agree that the company may contact you about this job on WhatsApp, phone or email.</p>
    </form>
  );
}
