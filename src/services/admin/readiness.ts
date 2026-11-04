import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { getSetting, setSetting } from "@/lib/settings";
import { getRazorpay } from "@/lib/razorpay";
import { getMetaConfig } from "@/providers/meta/config";
import { PROVIDER_LABEL, providerConfigured, providerHealth, resolveProviders, testProvider, type ProviderId } from "@/providers/ai/router";

/**
 * Integration readiness: one honest status per outside service.
 *
 * LIVE is shown ONLY after a real verification request to the provider succeeded (and recently) — a key being
 * present is not enough. Everything else says exactly what is missing.
 */
export type ReadinessStatus = "LIVE" | "CONFIGURATION_REQUIRED" | "APPROVAL_REQUIRED" | "PRACTICE_MODE" | "COMING_SOON" | "NOT_IMPLEMENTED";
export type Verification = { ok: boolean; at: string; detail: string };
export type ReadinessItem = {
  key: string;
  name: string;
  group: "AI" | "Messaging" | "Payments" | "Email" | "Google" | "Meta" | "Voice";
  status: ReadinessStatus;
  detail: string;
  needs: string;
  verifiable: boolean;
  configured: boolean;
  lastVerification: Verification | null;
  powers: string;
};

/** A verification older than this no longer counts as LIVE. */
export const VERIFY_MAX_AGE_MS = 7 * 86_400_000;
const has = (...names: string[]) => names.every((n) => Boolean(process.env[n]?.trim()));

async function lastCheck(key: string): Promise<Verification | null> {
  if (key === "anthropic" || key === "openai") {
    const h = await providerHealth(key);
    return h ? { ok: h.ok, at: h.at, detail: h.ok ? `Answered (${h.model}${h.source === "call" ? ", live traffic" : ""})` : h.error } : null;
  }
  try {
    const raw = await getSetting(`readiness:${key}`);
    return raw ? (JSON.parse(raw) as Verification) : null;
  } catch {
    return null;
  }
}
const fresh = (v: Verification | null) => Boolean(v?.ok && Date.now() - new Date(v.at).getTime() <= VERIFY_MAX_AGE_MS);

/** Status for a key-based integration: LIVE only with a fresh successful verification. */
function keyed(configured: boolean, v: Verification | null, missing: string): { status: ReadinessStatus; detail: string } {
  if (!configured) return { status: "CONFIGURATION_REQUIRED", detail: `Not set: ${missing}` };
  if (fresh(v)) return { status: "LIVE", detail: v!.detail || "Verified" };
  if (v && !v.ok) return { status: "CONFIGURATION_REQUIRED", detail: `Last check failed: ${v.detail}` };
  return { status: "CONFIGURATION_REQUIRED", detail: v ? "Verification is older than 7 days — verify again" : "Key set — not verified yet. Click Verify." };
}

export async function readinessList(): Promise<{ items: ReadinessItem[]; ai: Awaited<ReturnType<typeof resolveProviders>> }> {
  const keys = ["anthropic", "openai", "resend", "gemini", "maps", "meta_whatsapp", "razorpay", "razorpay_subscriptions"] as const;
  const checks = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await lastCheck(k)] as const))) as Record<(typeof keys)[number], Verification | null>;
  const meta = getMetaConfig();
  const metaSet = Boolean(meta.appId && meta.appSecret && meta.webhookVerifyToken);
  const rz = await getRazorpay();
  const connectedNumbers = await db.whatsAppAccount.count({ where: { status: "connected" } }).catch(() => 0);
  const ai = await resolveProviders();

  const aiItem = (p: ProviderId): ReadinessItem => {
    const s = keyed(providerConfigured(p), checks[p], p === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY");
    const role = ai.primary === p ? " · primary provider" : ai.fallback === p ? " · fallback" : "";
    return { key: p, name: PROVIDER_LABEL[p], group: "AI", ...s, detail: s.detail + role, needs: `Add ${p === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} in Vercel → Settings → Environment Variables (Sensitive), redeploy, then Verify.`, verifiable: true, configured: providerConfigured(p), lastVerification: checks[p], powers: "AI agent replies, conversation summaries, the automation AI step, social captions" };
  };

  const items: ReadinessItem[] = [
    aiItem("anthropic"),
    aiItem("openai"),
    { key: "resend", name: "Resend (email)", group: "Email", ...keyed(has("RESEND_API_KEY", "EMAIL_FROM"), checks.resend, "RESEND_API_KEY, EMAIL_FROM"), needs: "Add RESEND_API_KEY and EMAIL_FROM (a verified domain in Resend), redeploy, then Verify.", verifiable: true, configured: has("RESEND_API_KEY", "EMAIL_FROM"), lastVerification: checks.resend, powers: "Password reset, invoice emails, payment reminders by email, outreach email, email channel" },
    { key: "gemini", name: "Google Gemini", group: "AI", ...keyed(has("GEMINI_API_KEY"), checks.gemini, "GEMINI_API_KEY"), needs: "Add GEMINI_API_KEY (Google AI Studio), redeploy, then Verify.", verifiable: true, configured: has("GEMINI_API_KEY"), lastVerification: checks.gemini, powers: "Admin AI studio images and ad copy" },
    { key: "maps", name: "Google Maps (Places API)", group: "Google", ...keyed(has("GOOGLE_MAPS_API_KEY"), checks.maps, "GOOGLE_MAPS_API_KEY"), needs: "Enable Places API (New) in Google Cloud, add GOOGLE_MAPS_API_KEY, redeploy, then Verify.", verifiable: true, configured: has("GOOGLE_MAPS_API_KEY"), lastVerification: checks.maps, powers: "Admin outreach: Maps prospect finder" },
    (() => {
      const s = keyed(metaSet, checks.meta_whatsapp, "META_APP_ID, META_APP_SECRET, META_WEBHOOK_VERIFY_TOKEN");
      return { key: "meta_whatsapp", name: "Meta WhatsApp Cloud API", group: "Meta" as const, ...s, detail: `${s.detail} · ${connectedNumbers} connected number(s)`, needs: "Meta app keys in Vercel; webhook /api/webhooks/meta subscribed in the Meta app; then Verify.", verifiable: true, configured: metaSet, lastVerification: checks.meta_whatsapp, powers: "WhatsApp messaging, templates, embedded signup, Messenger/Instagram" };
    })(),
    { key: "meta_marketing", name: "Meta Marketing API (Ads Manager)", group: "Meta", status: "APPROVAL_REQUIRED", detail: "Needs Advanced Access for ads_management on the MECGURA Meta app (App Review).", needs: "Request ads_management / ads_read advanced access in Meta App Review.", verifiable: false, configured: false, lastVerification: null, powers: "Creating and launching ads from MECGURA" },
    { key: "gbp", name: "Google Business Profile", group: "Google", status: "APPROVAL_REQUIRED", detail: "Google Business Profile API access must be approved for MECGURA's Google Cloud project.", needs: "Apply for Business Profile API access; then OAuth app verification.", verifiable: false, configured: false, lastVerification: null, powers: "Reading and replying to Google reviews, profile insights" },
    { key: "google_ads", name: "Google Ads API", group: "Google", status: "APPROVAL_REQUIRED", detail: "Needs a Google Ads developer token (Basic access) and OAuth app review.", needs: "Apply for a developer token in the Google Ads API Center.", verifiable: false, configured: false, lastVerification: null, powers: "Ads sync and offline conversion upload" },
    { key: "voice", name: "Voice provider (AI calling)", group: "Voice", status: "PRACTICE_MODE", detail: "No telephony / speech provider connected. AI Calling runs in practice mode (transcripts and summaries only).", needs: "A voice provider account plus DLT / consent setup for outbound calls.", verifiable: false, configured: false, lastVerification: null, powers: "Real AI phone calls" },
    (() => {
      const s = keyed(Boolean(rz) && has("RAZORPAY_WEBHOOK_SECRET"), checks.razorpay, !rz ? "Razorpay key id (Admin → Settings) and RAZORPAY_KEY_SECRET" : "RAZORPAY_WEBHOOK_SECRET");
      return { key: "razorpay", name: "Razorpay (payments)", group: "Payments" as const, ...s, needs: "Key id in Admin → Settings → Razorpay, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET in Vercel, webhook /api/webhooks/payments/razorpay; then Verify.", verifiable: true, configured: Boolean(rz), lastVerification: checks.razorpay, powers: "Online invoice payments and wallet top-ups" };
    })(),
    (() => {
      const v = checks.razorpay_subscriptions;
      const s: { status: ReadinessStatus; detail: string } = !rz
        ? { status: "CONFIGURATION_REQUIRED", detail: "Connect Razorpay first." }
        : fresh(v)
          ? { status: "LIVE", detail: v!.detail }
          : v && !v.ok
            ? { status: "APPROVAL_REQUIRED", detail: `Razorpay: ${v.detail}` }
            : { status: "CONFIGURATION_REQUIRED", detail: "Not verified yet. Click Verify." };
      return { key: "razorpay_subscriptions", name: "Razorpay Subscriptions (auto-pay)", group: "Payments" as const, ...s, needs: "Enable Subscriptions on the Razorpay account and tick the subscription.* events on the webhook; then Verify.", verifiable: true, configured: Boolean(rz), lastVerification: v, powers: "Card / UPI AutoPay for plans" };
    })(),
    { key: "sms", name: "SMS (DLT)", group: "Messaging", status: "NOT_IMPLEMENTED", detail: "SMS sending isn't built and stays unavailable until DLT registration (entity, sender ID, templates) is complete.", needs: "DLT registration with an operator, then an SMS provider integration.", verifiable: false, configured: false, lastVerification: null, powers: "SMS campaigns and OTPs" },
    { key: "rcs", name: "RCS (Google RBM)", group: "Messaging", status: "COMING_SOON", detail: "Needs Google RBM partner / agent approval.", needs: "Google RBM partner approval and agent launch.", verifiable: false, configured: false, lastVerification: null, powers: "RCS rich messages" },
  ];
  return { items, ai };
}

// ---------------------------------------------------------------------------
// Verification — real requests to each provider
// ---------------------------------------------------------------------------

async function probe(url: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}
const errText = (b: Record<string, unknown>) => {
  const e = b.error as { message?: string } | string | undefined;
  return (typeof e === "string" ? e : e?.message) || String(b.message ?? b.name ?? "");
};

async function runCheck(key: string): Promise<Verification> {
  const at = new Date().toISOString();
  const done = (ok: boolean, detail: string): Verification => ({ ok, at, detail: detail.slice(0, 300) });
  try {
    switch (key) {
      case "resend": {
        if (!has("RESEND_API_KEY", "EMAIL_FROM")) return done(false, "RESEND_API_KEY / EMAIL_FROM not set.");
        const r = await probe("https://api.resend.com/domains", { headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
        if (r.status === 200) return done(true, `Key valid · sending from ${process.env.EMAIL_FROM}`);
        // A sending-only key can't list domains, but Resend recognised it.
        if (r.status === 401 && /restricted/i.test(String(r.body.name ?? errText(r.body)))) return done(true, `Sending-only key valid · sending from ${process.env.EMAIL_FROM}`);
        return done(false, `Resend ${r.status}: ${errText(r.body)}`);
      }
      case "gemini": {
        if (!has("GEMINI_API_KEY")) return done(false, "GEMINI_API_KEY not set.");
        const r = await probe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY! } });
        return r.status === 200 ? done(true, "Key valid") : done(false, `Gemini ${r.status}: ${errText(r.body)}`);
      }
      case "maps": {
        if (!has("GOOGLE_MAPS_API_KEY")) return done(false, "GOOGLE_MAPS_API_KEY not set.");
        const r = await probe("https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "content-type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY!, "X-Goog-FieldMask": "places.id" }, body: JSON.stringify({ textQuery: "salon in Ludhiana", pageSize: 1 }) });
        return r.status === 200 ? done(true, "Places API answered") : done(false, `Google ${r.status}: ${errText(r.body)}`);
      }
      case "meta_whatsapp": {
        const c = getMetaConfig();
        if (!c.appId || !c.appSecret) return done(false, "META_APP_ID / META_APP_SECRET not set.");
        const u = new URL(`https://graph.facebook.com/${c.graphVersion}/${c.appId}`);
        u.searchParams.set("fields", "id,name");
        u.searchParams.set("access_token", `${c.appId}|${c.appSecret}`);
        const r = await probe(u.toString());
        return r.status === 200 && r.body.id ? done(true, `App "${String(r.body.name ?? r.body.id)}" verified`) : done(false, `Meta ${r.status}: ${errText(r.body)}`);
      }
      case "razorpay":
      case "razorpay_subscriptions": {
        const rz = await getRazorpay();
        if (!rz) return done(false, "Razorpay key id / secret not set.");
        try {
          if (key === "razorpay") {
            await rz.client.orders.all({ count: 1 });
            return done(true, `Keys valid (${rz.mode} mode)${has("RAZORPAY_WEBHOOK_SECRET") ? "" : " · RAZORPAY_WEBHOOK_SECRET missing"}`);
          }
          await rz.client.subscriptions.all({ count: 1 });
          return done(true, `Subscriptions API available (${rz.mode} mode)`);
        } catch (e) {
          const x = e as { error?: { description?: string }; message?: string };
          return done(false, x?.error?.description || x?.message || "Razorpay refused the request.");
        }
      }
      default:
        throw new ApiError("VALIDATION_ERROR", "This integration can't be verified automatically.");
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    return done(false, "Couldn't reach the provider (network or timeout).");
  }
}

/** Verifies one integration with a real request and stores the result. */
export async function verifyIntegration(key: string): Promise<Verification> {
  if (key === "anthropic" || key === "openai") {
    const h = await testProvider(key);
    return { ok: h.ok, at: h.at, detail: h.ok ? `Answered (${h.model})` : h.error };
  }
  const v = await runCheck(key);
  await setSetting(`readiness:${key}`, JSON.stringify(v));
  return v;
}

export const VERIFIABLE = ["anthropic", "openai", "resend", "gemini", "maps", "meta_whatsapp", "razorpay", "razorpay_subscriptions"];
