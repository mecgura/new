import type { SendResult } from "./types";

/** Overridable in tests; production always uses the platform fetch. */
let impl: typeof fetch = (...a) => fetch(...a);
export const providerFetch: typeof fetch = (...a) => impl(...a);
export function __setProviderFetch(f: typeof fetch | null) { impl = f ?? ((...a) => fetch(...a)); }

export const TIMEOUT_MS = 10_000;
/** Strips anything that looks like one of our configured secrets from provider error text before it is stored or shown. */
export function scrub(text: string): string {
  let out = String(text ?? "");
  for (const k of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "SMS_API_KEY", "SMS_ACCOUNT_SID", "EMAIL_API_KEY", "EMAIL_WEBHOOK_SECRET"]) { const v = process.env[k]; if (v && v.length >= 6) out = out.split(v).join("[redacted]"); }
  return out.replace(/\s+/g, " ").slice(0, 200);
}
/** One provider call with a timeout. Network errors / 408 / 429 / 5xx are retryable; other 4xx are permanent (the provider rejected the message). */
export async function callProvider(url: string, init: RequestInit): Promise<{ ok: true; status: number; json: unknown } | { ok: false; result: Extract<SendResult, { ok: false }> }> {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await providerFetch(url, { ...init, signal: ac.signal });
    const text = await res.text(); let json: unknown = null; try { json = JSON.parse(text); } catch { /* not json */ }
    if (res.ok) return { ok: true, status: res.status, json };
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    const detail = (json as { error?: { message?: string } | string; message?: string } | null);
    const msg = typeof detail?.error === "string" ? detail.error : detail?.error?.message ?? detail?.message ?? text;
    return { ok: false, result: { ok: false, retryable, code: `HTTP_${res.status}`, message: scrub(msg) } };
  } catch (e) {
    const timeout = (e as { name?: string })?.name === "AbortError";
    return { ok: false, result: { ok: false, retryable: true, code: timeout ? "TIMEOUT" : "NETWORK_ERROR", message: timeout ? "The provider did not answer in time." : "The provider could not be reached." } };
  } finally { clearTimeout(timer); }
}
