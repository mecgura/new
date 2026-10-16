import { createHmac, timingSafeEqual } from "node:crypto";

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Meta: `X-Hub-Signature-256: sha256=<hex hmac of the RAW body with the app secret>`. */
export function verifyMeta(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  return safeEqual(header.slice(7), createHmac("sha256", appSecret).update(rawBody).digest("hex"));
}
/** Twilio: `X-Twilio-Signature` = base64 HMAC-SHA1(authToken, url + each POST param name+value sorted by name). */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", authToken).update(data).digest("base64");
}
export function verifyTwilio(url: string, params: Record<string, string>, header: string | null, authToken: string | undefined): boolean {
  if (!authToken || !header) return false;
  return safeEqual(header, twilioSignature(authToken, url, params));
}
/** Svix (used by Resend): signed content `${id}.${timestamp}.${body}`, secret `whsec_<base64>`, header `v1,<base64>` (space separated list). Timestamp must be recent (replay window). */
export const SVIX_TOLERANCE_S = 300;
export function svixSignature(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}
export function verifySvix(rawBody: string, headers: Headers, secret: string | undefined, nowMs = Date.now()): { ok: boolean; reason?: string } {
  const id = headers.get("svix-id"), ts = headers.get("svix-timestamp"), sig = headers.get("svix-signature");
  if (!secret) return { ok: false, reason: "no_secret" };
  if (!id || !ts || !sig) return { ok: false, reason: "missing_headers" };
  const t = Number(ts); if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > SVIX_TOLERANCE_S) return { ok: false, reason: "stale_timestamp" };
  const expected = svixSignature(secret, id, ts, rawBody);
  const ok = sig.split(" ").some((p) => { const [v, s] = p.split(","); return v === "v1" && !!s && safeEqual(s, expected); });
  return ok ? { ok } : { ok: false, reason: "bad_signature" };
}
