import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { type Channel, type EventType, type VarName } from "./catalog";
import { emitCommunication, loadPatientFacts, patientBlock } from "./dispatch";
import { renderEmailHtml } from "./email-html";
import { loadTenantProfile } from "./links";
import { configuredProvider } from "./providers/registry";
import type { EmailProvider, SendResult, SmsProvider, StatusUpdate, WhatsAppProvider } from "./providers/types";
import { channelEnabled, loadSettings } from "./settings";
import { usedVariables, renderTemplate } from "./template-engine";

const BACKOFF_MIN = [1, 5, 30, 120, 360, 720];
const STUCK_MS = 10 * 60_000;
const parse = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };
type Msg = NonNullable<Awaited<ReturnType<typeof db.communicationMessage.findFirst>>>;

async function log(m: { id: string; tenantId: string }, status: string, source: string, code?: string | null, note?: string | null) {
  await db.communicationAttempt.create({ data: { tenantId: m.tenantId, messageId: m.id, status, source, code: code ?? null, note: note ? note.slice(0, 200) : null } });
}
async function finish(m: Msg, status: "FAILED" | "CANCELLED", code: string, reason: string) {
  await db.communicationMessage.update({ where: { id: m.id }, data: { status, failureCode: code, failureReason: reason.slice(0, 200), failedAt: new Date(), nextAttemptAt: null } });
  await log(m, status, "SYSTEM", code, reason);
  if (status === "FAILED") await recordAudit({ action: AUDIT_ACTIONS.COMM_MESSAGE_FAILED, tenantId: m.tenantId, entityType: "communication_message", entityId: m.id, metadata: { event: m.eventType, channel: m.channel, code } });
  if (status === "FAILED") await maybeFallback({ ...m, status });
}

/** Explicit fallback only (clinic rule WHATSAPP→SMS etc.), only for a message that failed for good, and only through the normal consent / provider / template checks. */
export async function maybeFallback(m: Msg) {
  if (m.fallbackOfId || m.category === "MARKETING") return;
  const s = await loadSettings(m.tenantId); const to = s.fallbackRules[m.channel as Channel]; if (!to || !channelEnabled(s, to)) return;
  const ctx = parse<{ eventKey?: string; vars?: Partial<Record<VarName, string>>; linkPath?: string | null }>(m.context, {}); if (!ctx.eventKey) return;
  await emitCommunication({ tenantId: m.tenantId, event: m.eventType as EventType, patientId: m.patientId, eventKey: ctx.eventKey, entityType: m.entityType ?? undefined, entityId: m.entityId ?? undefined, vars: ctx.vars, linkPath: ctx.linkPath ?? undefined, only: [to], fallbackOfId: m.id, ignoreToggle: true });
}

async function entityStillValid(m: Msg): Promise<boolean> {
  if (m.entityType !== "appointment" || !m.entityId) return true;
  if (!["APPOINTMENT_REMINDER", "APPOINTMENT_CONFIRMED", "APPOINTMENT_REQUESTED"].includes(m.eventType)) return true;
  const a = await db.appointment.findFirst({ where: { id: m.entityId, tenantId: m.tenantId }, select: { status: true } });
  return !!a && !["CANCELLED", "NO_SHOW", "COMPLETED"].includes(a.status);
}

async function transmit(m: Msg, t: NonNullable<Awaited<ReturnType<typeof loadTenantProfile>>>, s: Awaited<ReturnType<typeof loadSettings>>): Promise<SendResult> {
  const p = configuredProvider(m.channel as Channel); if (!p) return { ok: false, retryable: false, code: "PROVIDER_NOT_CONFIGURED", message: "The provider is not configured." };
  const tpl = m.templateId ? await db.communicationTemplate.findFirst({ where: { id: m.templateId, tenantId: m.tenantId } }) : null;
  if (m.channel === "WHATSAPP") {
    if (!tpl?.providerTemplateId) return { ok: false, retryable: false, code: "NO_APPROVED_TEMPLATE", message: "No approved WhatsApp template." };
    const ctx = parse<{ vars?: Partial<Record<VarName, string>> }>(m.context, {}); const order = parse<string[]>(tpl.variables, []); const names = order.length ? order : usedVariables(tpl.body);
    const params = names.map((n) => renderTemplate(`{{${n}}}`, ctx.vars ?? {}) || "-");
    return (p as WhatsAppProvider).sendTemplate({ to: m.recipient, templateName: tpl.providerTemplateId, language: m.language, params });
  }
  if (m.channel === "SMS") return (p as SmsProvider).sendSMS({ to: m.recipient, text: m.body, templateId: tpl?.providerTemplateId ?? null });
  const { html, text } = renderEmailHtml(t, { subject: m.subject ?? "", text: m.body, link: m.link, senderName: s.senderName });
  return (p as EmailProvider).sendEmail({ to: m.recipient, fromName: s.senderName || t.name, replyTo: s.replyTo || t.email, subject: m.subject ?? "", html, text });
}

/** Sends ONE claimed message and records the outcome. */
export async function deliver(m: Msg): Promise<"SENT" | "RETRYING" | "FAILED" | "CANCELLED"> {
  const [t, s] = await Promise.all([loadTenantProfile(m.tenantId), loadSettings(m.tenantId)]);
  if (!t || !["ACTIVE", "TRIAL"].includes(t.status)) { await finish(m, "CANCELLED", "TENANT_INACTIVE", "The clinic is not active."); return "CANCELLED"; }
  if (!channelEnabled(s, m.channel as Channel)) { await finish(m, "CANCELLED", "CHANNEL_DISABLED", "The channel was switched off before sending."); return "CANCELLED"; }
  if (!(await entityStillValid(m))) { await finish(m, "CANCELLED", "ENTITY_CHANGED", "The appointment is no longer active."); return "CANCELLED"; }
  const f = m.patientId ? await loadPatientFacts(m.tenantId, m.patientId) : null;
  const block = f ? patientBlock(f, m.eventType as EventType, m.channel as Channel) : "PATIENT_UNAVAILABLE";
  if (block) { await finish(m, "CANCELLED", block, "The patient's preferences changed before sending."); return "CANCELLED"; }
  let r: SendResult;
  try { r = await transmit(m, t, s); } catch (err) { logger.error("provider adapter crashed", { error: err }); r = { ok: false, retryable: true, code: "ADAPTER_ERROR", message: "Unexpected error while sending." }; }
  if (r.ok) {
    await db.communicationMessage.update({ where: { id: m.id }, data: { status: "SENT", providerMessageId: r.providerMessageId, sentAt: new Date(), nextAttemptAt: null, failureCode: null, failureReason: null } });
    await log(m, "SENT", "PROVIDER", null, "Accepted by the provider");
    await recordAudit({ action: AUDIT_ACTIONS.COMM_MESSAGE_SENT, tenantId: m.tenantId, entityType: "communication_message", entityId: m.id, metadata: { event: m.eventType, channel: m.channel, provider: m.provider } });
    return "SENT";
  }
  if (r.retryable && m.attempts < m.maxAttempts) {
    const when = new Date(Date.now() + (BACKOFF_MIN[Math.min(m.attempts - 1, BACKOFF_MIN.length - 1)] ?? 720) * 60_000);
    await db.communicationMessage.update({ where: { id: m.id }, data: { status: "RETRYING", nextAttemptAt: when, failureCode: r.code, failureReason: r.message } });
    await log(m, "RETRYING", "PROVIDER", r.code, r.message);
    await recordAudit({ action: AUDIT_ACTIONS.COMM_MESSAGE_RETRIED, tenantId: m.tenantId, entityType: "communication_message", entityId: m.id, metadata: { event: m.eventType, channel: m.channel, attempt: m.attempts, code: r.code } });
    return "RETRYING";
  }
  await finish(m, "FAILED", r.code, r.retryable ? `${r.message} (gave up after ${m.attempts} attempts)` : r.message);
  return "FAILED";
}

/** Claims and delivers due messages. Safe to run concurrently (each message is claimed with a compare-and-swap). */
export async function processDue(o: { limit?: number; tenantId?: string; now?: Date } = {}) {
  const now = o.now ?? new Date(); const limit = Math.min(200, o.limit ?? 50);
  // crash recovery: a message stuck in PROCESSING (worker died) that was never accepted by a provider goes back in the queue
  await db.communicationMessage.updateMany({ where: { status: "PROCESSING", providerMessageId: null, updatedAt: { lt: new Date(now.getTime() - STUCK_MS) } }, data: { status: "RETRYING", nextAttemptAt: now } });
  const due = await db.communicationMessage.findMany({ where: { status: { in: ["QUEUED", "RETRYING"] }, scheduledAt: { lte: now }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }], ...(o.tenantId ? { tenantId: o.tenantId } : {}) }, orderBy: [{ scheduledAt: "asc" }], take: limit * 2, select: { id: true, priority: true } });
  const rank = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as Record<string, number>;
  due.sort((a, b) => (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2));
  const out = { claimed: 0, sent: 0, retrying: 0, failed: 0, cancelled: 0 };
  for (const d of due.slice(0, limit)) {
    const claim = await db.communicationMessage.updateMany({ where: { id: d.id, status: { in: ["QUEUED", "RETRYING"] } }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
    if (claim.count !== 1) continue; out.claimed++;
    const m = await db.communicationMessage.findUniqueOrThrow({ where: { id: d.id } });
    await log(m, "PROCESSING", "SYSTEM");
    try { const r = await deliver(m); if (r === "SENT") out.sent++; else if (r === "RETRYING") out.retrying++; else if (r === "FAILED") out.failed++; else out.cancelled++; }
    catch (err) { logger.error("communication delivery crashed", { error: err }); await db.communicationMessage.update({ where: { id: m.id }, data: { status: "RETRYING", nextAttemptAt: new Date(now.getTime() + 5 * 60_000), failureCode: "INTERNAL_ERROR", failureReason: "Unexpected error." } }); out.retrying++; }
  }
  return out;
}

/* ------------------------------------------------ provider callbacks ------------------------------------------------ */
export type WebhookOutcome = "applied" | "ignored_older" | "duplicate" | "unknown_message";
const RANK: Record<string, number> = { QUEUED: 0, PROCESSING: 1, RETRYING: 1, SENT: 2, DELIVERED: 3, READ: 4 };
/** Applies ONE verified provider status. Idempotent (eventKey) and monotonic (a late "sent" never undoes "delivered"). */
export async function applyProviderStatus(provider: string, u: StatusUpdate): Promise<WebhookOutcome> {
  const eventKey = `${provider}|${u.eventKey}`;
  const m = await db.communicationMessage.findFirst({ where: { provider, providerMessageId: u.providerMessageId } });
  try { await db.communicationWebhookEvent.create({ data: { provider, eventKey, messageId: m?.id ?? null, status: u.status, outcome: m ? "received" : "unknown_message" } }); }
  catch (e) { if ((e as { code?: string })?.code === "P2002") return "duplicate"; throw e; }
  if (!m) return "unknown_message";
  const cur = m.status; const at = u.at ?? new Date();
  if (u.status === "FAILED") {
    if (cur === "DELIVERED" || cur === "READ" || cur === "FAILED") return "ignored_older";
    await db.communicationMessage.update({ where: { id: m.id }, data: { status: "FAILED", failedAt: at, failureCode: u.code ?? "PROVIDER_REPORTED_FAILURE", failureReason: "The provider reported that the message could not be delivered." } });
    await log(m, "FAILED", "WEBHOOK", u.code);
    await recordAudit({ action: AUDIT_ACTIONS.COMM_MESSAGE_FAILED, tenantId: m.tenantId, entityType: "communication_message", entityId: m.id, metadata: { event: m.eventType, channel: m.channel, code: u.code ?? "PROVIDER_REPORTED_FAILURE", via: "webhook" } });
    await maybeFallback({ ...m, status: "FAILED" });
    return "applied";
  }
  if ((RANK[u.status] ?? 0) <= (RANK[cur] ?? 0) && cur !== "FAILED") return "ignored_older";
  const data: Record<string, unknown> = { status: u.status, ...(u.status === "SENT" ? { sentAt: m.sentAt ?? at } : {}), ...(u.status === "DELIVERED" ? { deliveredAt: at, sentAt: m.sentAt ?? at } : {}), ...(u.status === "READ" ? { readAt: at, deliveredAt: m.deliveredAt ?? at, sentAt: m.sentAt ?? at } : {}), ...(cur === "FAILED" ? { failureCode: null, failureReason: null, failedAt: null } : {}) };
  await db.communicationMessage.update({ where: { id: m.id }, data });
  await log(m, u.status, "WEBHOOK", u.code);
  return "applied";
}
