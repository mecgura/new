import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { utcToZoned, zonedToUtc, addDays } from "@/lib/scheduling/time";
import { EVENTS, LANGUAGES, type Channel, type EventType, type Language, type VarName } from "./catalog";
import { builtinText } from "./defaults";
import { loadTenantProfile, portalLink, type TenantProfile } from "./links";
import { providerFor, configuredProvider } from "./providers/registry";
import { channelEnabled, eventEnabled, loadSettings, type CommSettings } from "./settings";
import { renderTemplate } from "./template-engine";

export interface EmitInput {
  tenantId: string; event: EventType; patientId: string | null | undefined;
  /** idempotency: the same eventKey (+ channel) can only ever produce ONE message. Include the business entity and the thing that makes a new message legitimate (a new time, a new version). */
  eventKey: string; entityType?: string; entityId?: string; vars?: Partial<Record<VarName, string>>; linkPath?: string;
  scheduledAt?: Date; createdById?: string | null;
  /** internal: restrict to certain channels / mark a fallback or resend */
  only?: Channel[]; fallbackOfId?: string; resendOfId?: string; ignoreToggle?: boolean;
}
export interface EmitResult { queued: string[]; skipped: string | null; duplicate: boolean; reason?: string }

const SKIP_REASON: Record<string, string> = {
  CHANNEL_DISABLED: "This channel is switched off for the clinic.", PROVIDER_NOT_CONFIGURED: "The provider is not configured on the server.", NO_CONTACT: "The patient has no number / email for this channel.",
  CHANNEL_OPT_OUT: "The patient opted out of this channel.", WHATSAPP_NOT_OPTED_IN: "The patient has not agreed to WhatsApp messages.", NO_CONSENT: "The patient has not given (or has withdrawn) consent.",
  CATEGORY_OFF: "The patient switched this kind of notification off.", NO_TEMPLATE: "No active template for this channel / language.", RATE_LIMITED: "Daily message limit for this patient reached.", PATIENT_UNAVAILABLE: "The patient record is not available.",
  EVENT_DISABLED: "This notification is switched off for the clinic.", NO_CHANNEL_ENABLED: "No channel is enabled.",
};
export const skipReasonText = (code: string | null | undefined) => (code ? SKIP_REASON[code] ?? "Not sent." : "");

const parse = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };
const isE164 = (p: string | null | undefined): p is string => !!p && /^\+\d{8,15}$/.test(p);

/** Everything the rules need to know about the patient, read ONCE per event. */
export interface PatientFacts { id: string; name: string; phone: string | null; email: string | null; pref: Record<Channel, string>; categories: Record<string, boolean>; language: Language | null; consent: "GRANTED" | "WITHDRAWN" | "NONE"; available: boolean }
export async function loadPatientFacts(tenantId: string, patientId: string): Promise<PatientFacts | null> {
  const p = await db.patient.findFirst({ where: { id: patientId, tenantId, deletedAt: null }, select: { id: true, name: true, preferredName: true, phone: true, email: true, status: true, prefWhatsapp: true, prefSms: true, prefEmail: true } });
  if (!p) return null;
  const [acc, consent] = await Promise.all([db.patientAccount.findFirst({ where: { patientId, tenantId }, select: { prefs: true } }), db.patientConsent.findFirst({ where: { patientId, tenantId, type: "COMMUNICATION" }, orderBy: { recordedAt: "desc" }, select: { status: true } })]);
  const prefs = parse<Record<string, unknown>>(acc?.prefs, {}); const lang = (LANGUAGES as readonly string[]).includes(prefs.language as string) ? (prefs.language as Language) : null;
  const categories: Record<string, boolean> = {}; for (const k of ["appointments", "followUps", "billing", "reports", "general"]) if (typeof prefs[k] === "boolean") categories[k] = prefs[k] as boolean;
  return { id: p.id, name: (p.preferredName || p.name).split(" ")[0], phone: isE164(p.phone) ? p.phone : null, email: p.email ?? null, pref: { WHATSAPP: p.prefWhatsapp, SMS: p.prefSms, EMAIL: p.prefEmail }, categories, language: lang, consent: (consent?.status as "GRANTED" | "WITHDRAWN" | undefined) ?? "NONE", available: p.status !== "ARCHIVED" };
}

/** Pure consent / preference rules (no I/O) — also used again at send time. Returns an error code or null. */
export function patientBlock(f: PatientFacts, event: EventType, channel: Channel): string | null {
  const ev = EVENTS[event];
  if (!f.available) return "PATIENT_UNAVAILABLE";
  const contact = channel === "EMAIL" ? f.email : f.phone; if (!contact) return "NO_CONTACT";
  const pref = f.pref[channel];
  if (pref === "NOT_ALLOWED") return "CHANNEL_OPT_OUT";
  // WhatsApp business messaging needs an explicit opt-in; SMS/email transactional messages do not.
  if (channel === "WHATSAPP" && pref !== "ALLOWED") return "WHATSAPP_NOT_OPTED_IN";
  if (ev.category === "MARKETING") { if (pref !== "ALLOWED" || f.consent !== "GRANTED") return "NO_CONSENT"; }
  else if (ev.category === "TRANSACTIONAL") { if (f.consent === "WITHDRAWN") return "NO_CONSENT"; if (f.categories[ev.pref] === false) return "CATEGORY_OFF"; }
  return null;
}

/** Quiet hours: LOW / NORMAL messages wait until the quiet window ends, in the CLINIC's time zone. HIGH / CRITICAL are never delayed. */
export function applyQuietHours(s: CommSettings, tz: string, at: Date, priority: string): Date {
  if (!s.quiet.enabled || priority === "HIGH" || priority === "CRITICAL") return at;
  const z = utcToZoned(at, tz); const { startMin: a, endMin: b } = s.quiet; if (a === b) return at;
  const inside = a < b ? z.minutes >= a && z.minutes < b : z.minutes >= a || z.minutes < b; if (!inside) return at;
  const today = z.date; const endDay = a < b || z.minutes < b ? today : addDays(today, 1);
  return zonedToUtc(endDay, b, tz);
}

export async function resolveTemplate(tenantId: string, channel: Channel, event: EventType, langs: Language[]) {
  const rows = await db.communicationTemplate.findMany({ where: { tenantId, channel, eventType: event, status: "ACTIVE" }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] });
  for (const lang of langs) {
    const r = rows.find((x) => x.language === lang);
    if (r) { if (channel === "WHATSAPP" && !r.providerTemplateId) continue; return { id: r.id as string | null, subject: r.subject, body: r.body, providerTemplateId: r.providerTemplateId, language: lang, variables: parse<string[]>(r.variables, []), builtin: false }; }
    if (channel !== "WHATSAPP") { const b = builtinText(event, lang); if (b) return { id: null, subject: b.subject, body: b.text, providerTemplateId: null, language: lang, variables: [] as string[], builtin: true }; }
  }
  return null;
}

async function dailyCount(tenantId: string, patientId: string, channel: Channel) {
  return db.communicationMessage.count({ where: { tenantId, patientId, channel, category: { not: "SECURITY" }, status: { notIn: ["SKIPPED", "CANCELLED"] }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
}

/** Builds the variable map shown to templates. Only whitelisted names, only non-sensitive values. */
export function baseVars(t: TenantProfile, f: PatientFacts | null, extra: Partial<Record<VarName, string>> | undefined, link: string | null): Partial<Record<VarName, string>> {
  return { clinic_name: t.name, clinic_phone: t.phone ?? "the clinic", clinic_address: t.address, patient_name: f?.name ?? "Patient", ...(link ? { portal_link: link } : {}), ...extra };
}

export async function emitCommunication(i: EmitInput): Promise<EmitResult> {
  const ev = EVENTS[i.event];
  const s = await loadSettings(i.tenantId);
  const enabled = s.channelOrder.filter((c) => channelEnabled(s, c) && (!i.only || i.only.includes(c)));
  if (!enabled.length) return { queued: [], skipped: "NO_CHANNEL_ENABLED", duplicate: false };
  if (!i.ignoreToggle && !eventEnabled(s, i.event)) return { queued: [], skipped: "EVENT_DISABLED", duplicate: false };
  const t = await loadTenantProfile(i.tenantId); if (!t || !["ACTIVE", "TRIAL"].includes(t.status)) return { queued: [], skipped: "PATIENT_UNAVAILABLE", duplicate: false };
  const f = i.patientId ? await loadPatientFacts(i.tenantId, i.patientId) : null;
  if (!f) return { queued: [], skipped: "PATIENT_UNAVAILABLE", duplicate: false };
  const langs = [...new Set([f.language, s.defaultLanguage, "en"].filter((x): x is Language => !!x))];
  const reasons: string[] = [];
  const link = i.linkPath ? portalLink(t, i.linkPath) : null;
  for (const channel of enabled) {
    const blocked = (() => { if (!configuredProvider(channel)) return "PROVIDER_NOT_CONFIGURED"; return patientBlock(f, i.event, channel); })();
    if (blocked) { reasons.push(blocked); continue; }
    const tpl = await resolveTemplate(i.tenantId, channel, i.event, langs); if (!tpl) { reasons.push("NO_TEMPLATE"); continue; }
    if ((ev.priority as string) !== "CRITICAL" && ev.category !== "SECURITY" && (await dailyCount(i.tenantId, f.id, channel)) >= s.dailyCapPerPatient) { reasons.push("RATE_LIMITED"); continue; }
    const vars = baseVars(t, f, i.vars, link);
    const body = renderTemplate(tpl.body, vars); const subject = tpl.subject ? renderTemplate(tpl.subject, vars) : null;
    const scheduledAt = applyQuietHours(s, t.timezone, i.scheduledAt ?? new Date(), ev.priority);
    try {
      const m = await db.communicationMessage.create({ data: {
        tenantId: i.tenantId, patientId: f.id, channel, eventType: i.event, category: ev.category, priority: ev.priority, templateId: tpl.id, language: tpl.language, entityType: i.entityType ?? null, entityId: i.entityId ?? null,
        recipient: channel === "EMAIL" ? f.email! : f.phone!, subject, body, link, context: JSON.stringify({ eventKey: i.eventKey, vars, linkPath: i.linkPath ?? null }), provider: providerFor(channel)?.name ?? null,
        status: "QUEUED", scheduledAt, nextAttemptAt: scheduledAt, maxAttempts: s.maxRetries + 1, dedupeKey: `${i.eventKey}:${channel}${i.fallbackOfId ? ":fb" : ""}${i.resendOfId ? `:rs${Date.now().toString(36)}` : ""}`, fallbackOfId: i.fallbackOfId ?? null, resendOfId: i.resendOfId ?? null, createdById: i.createdById ?? null,
      } });
      await db.communicationAttempt.create({ data: { tenantId: i.tenantId, messageId: m.id, status: "QUEUED", source: "SYSTEM" } });
      await recordAudit({ action: AUDIT_ACTIONS.COMM_MESSAGE_QUEUED, tenantId: i.tenantId, actorId: i.createdById ?? undefined, entityType: "communication_message", entityId: m.id, metadata: { event: i.event, channel, priority: ev.priority } });
      return { queued: [m.id], skipped: null, duplicate: false };
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") return { queued: [], skipped: null, duplicate: true };
      throw e;
    }
  }
  // Nothing could be sent: keep ONE visible row so staff can see why (never silently drop).
  const first = enabled[0]; const code = reasons[0] ?? "NO_TEMPLATE";
  try {
    const m = await db.communicationMessage.create({ data: { tenantId: i.tenantId, patientId: f.id, channel: first, eventType: i.event, category: ev.category, priority: ev.priority, entityType: i.entityType ?? null, entityId: i.entityId ?? null, recipient: first === "EMAIL" ? f.email ?? "—" : f.phone ?? "—", body: "", status: "SKIPPED", failureCode: code, failureReason: [...new Set(reasons)].map((r) => skipReasonText(r)).join(" "), context: JSON.stringify({ eventKey: i.eventKey, vars: i.vars ?? {}, linkPath: i.linkPath ?? null }), dedupeKey: `${i.eventKey}:skip${i.resendOfId ? `:rs${Date.now().toString(36)}` : ""}`, resendOfId: i.resendOfId ?? null, createdById: i.createdById ?? null } });
    await db.communicationAttempt.create({ data: { tenantId: i.tenantId, messageId: m.id, status: "SKIPPED", source: "SYSTEM", code } });
  } catch (e) { if ((e as { code?: string })?.code !== "P2002") throw e; return { queued: [], skipped: code, duplicate: true, reason: code }; }
  return { queued: [], skipped: code, duplicate: false, reason: code };
}

/** What business modules call. Never throws, never waits for a provider: a messaging problem must NEVER fail the clinical / billing action that triggered it. */
export async function safeEmit(i: EmitInput): Promise<EmitResult | null> {
  try { const r = await emitCommunication(i); if (r.queued.length) kickQueue(); return r; }
  catch (err) { logger.error("communication emit failed", { event: i.event, error: err }); return null; }
}

let lastKick = 0;
/** Opportunistic, non-blocking delivery of due messages right after they were queued. The scheduler endpoint remains the dependable path (retries, reminders). */
export function kickQueue() {
  if (process.env.COMMUNICATIONS_INLINE_WORKER === "false" || Date.now() - lastKick < 3000) return; lastKick = Date.now();
  void import("./worker").then((w) => w.processDue({ limit: 20 })).catch((err) => logger.error("communication kick failed", { error: err }));
}
