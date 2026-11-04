"use client";

import * as React from "react";

type Utm = { utmSource: string; utmMedium: string; utmCampaign: string };
const KEY = "lp_visitor";

function visitorId() {
  try {
    let v = localStorage.getItem(KEY);
    if (!v) {
      v = Math.random().toString(36).slice(2, 12);
      localStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    return "";
  }
}
function utm(): Utm {
  if (typeof window === "undefined") return { utmSource: "", utmMedium: "", utmCampaign: "" };
  const q = new URLSearchParams(window.location.search);
  return { utmSource: q.get("utm_source") ?? "", utmMedium: q.get("utm_medium") ?? "", utmCampaign: q.get("utm_campaign") ?? "" };
}
function beacon(pageId: string, body: Record<string, unknown>) {
  const data = JSON.stringify({ ...body, visitor: visitorId(), ...utm() });
  try {
    if (navigator.sendBeacon?.(`/api/lp/${pageId}/event`, new Blob([data], { type: "text/plain" }))) return;
  } catch {
    /* fall through */
  }
  void fetch(`/api/lp/${pageId}/event`, { method: "POST", body: data, keepalive: true }).catch(() => null);
}

/** Counts one view per page load (skipped in the builder preview). */
export function ViewTracker({ pageId }: { pageId: string }) {
  React.useEffect(() => {
    beacon(pageId, { kind: "view", referrer: document.referrer });
  }, [pageId]);
  return null;
}

/** A button or link that counts its click before leaving. */
export function TrackedLink({ pageId, name, href, className, style, children, preview }: { pageId: string | null; name: string; href: string; className?: string; style?: React.CSSProperties; children: React.ReactNode; preview?: boolean }) {
  const external = /^https?:/.test(href);
  return (
    <a
      href={href || "#"}
      className={className}
      style={style}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      onClick={(e) => {
        if (preview) return e.preventDefault();
        if (pageId) beacon(pageId, { kind: "click", name });
      }}
    >
      {children}
    </a>
  );
}

type Form = { id: string; heading: string; text: string; askEmail: boolean; askMessage: boolean; messageLabel: string; submitLabel: string; consentText: string };

export function LeadForm({ pageId, form, accent, preview }: { pageId: string | null; form: Form; accent: string; preview?: boolean }) {
  const [f, setF] = React.useState({ name: "", phone: "", email: "", message: "", consent: false, website: "" });
  const [state, setState] = React.useState<"idle" | "sending" | "done">("idle");
  const [msg, setMsg] = React.useState("");
  const [err, setErr] = React.useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (preview || !pageId) return setErr("This is a preview. Publish the page to receive leads.");
    setState("sending");
    setErr("");
    const res = await fetch(`/api/lp/${pageId}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blockId: form.id, ...f, visitor: visitorId(), ...utm() }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { message?: string; error?: string };
    if (!res?.ok) {
      setErr(body.error ?? "Couldn't send. Please try again.");
      return setState("idle");
    }
    setMsg(body.message ?? "Thank you!");
    setState("done");
  }
  const input = "mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-[15px] text-[#14211b] outline-none focus:border-black/40";
  if (state === "done") return <p className="rounded-2xl bg-white p-6 text-center text-lg font-semibold text-[#14211b]" role="status">{msg}</p>;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-white p-5 text-left shadow-sm sm:p-6">
      <label className="block text-sm font-medium text-[#14211b]">Name<input required maxLength={80} className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></label>
      <label className="block text-sm font-medium text-[#14211b]">Mobile (WhatsApp)<input required type="tel" inputMode="tel" maxLength={20} className={input} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+91 98765 43210" autoComplete="tel" /></label>
      {form.askEmail ? <label className="block text-sm font-medium text-[#14211b]">Email<input type="email" maxLength={200} className={input} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></label> : null}
      {form.askMessage ? <label className="block text-sm font-medium text-[#14211b]">{form.messageLabel || "Message"}<textarea maxLength={1000} rows={3} className={input} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label> : null}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      {form.consentText ? (
        <label className="flex items-start gap-2 text-sm text-[#45584d]">
          <input type="checkbox" className="mt-1 size-4" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
          <span>{form.consentText}</span>
        </label>
      ) : null}
      {err ? <p role="alert" className="text-sm text-red-700">{err}</p> : null}
      <button type="submit" disabled={state === "sending"} className="h-12 w-full rounded-xl text-base font-semibold text-white disabled:opacity-60" style={{ background: accent }}>
        {state === "sending" ? "Sending…" : form.submitLabel || "Send"}
      </button>
    </form>
  );
}
