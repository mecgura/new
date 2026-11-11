import "server-only";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { CHANNELS, EVENTS, EVENT_TYPES, SAMPLE_VARS, LIMITS, VARIABLES, type Channel, type EventType, type Language, type StaffGroup } from "@/lib/communications/catalog";
import { builtinLanguages, builtinText } from "@/lib/communications/defaults";
import { emitCommunication, skipReasonText } from "@/lib/communications/dispatch";
import { renderEmailHtml } from "@/lib/communications/email-html";
import { loadTenantProfile } from "@/lib/communications/links";
import { providerStatus } from "@/lib/communications/providers/registry";
import { loadSettings, toSettings } from "@/lib/communications/settings";
import { renderTemplate, usedVariables, validateTemplate } from "@/lib/communications/template-engine";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { commSettingsSchema, messageQuerySchema, previewSchema, templateSchema, templateStatusSchema } from "@/lib/validation/communications";
import { containsCI } from "./shared";
import type { Client } from "./clinic-shared";

const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;
const PAGE = 20;
const parse = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

/* ------------------------------------------------ who may see what ------------------------------------------------ */
const ALL_GROUPS: StaffGroup[] = ["APPOINTMENT", "OPD", "PRESCRIPTION", "LAB", "FOLLOWUP", "BILLING", "ACCOUNT"];
const GROUPS: Record<string, StaffGroup[]> = {
  CLINIC_ADMIN: ALL_GROUPS, RECEPTIONIST: ALL_GROUPS,
  DOCTOR: ["APPOINTMENT", "OPD", "PRESCRIPTION", "LAB", "FOLLOWUP"], ACCOUNTANT: ["BILLING"], LAB_STAFF: ["LAB"],
};
function viewGuard(ctx: TenantRequestContext) {
  if (ctx.user.role === "SUPER_ADMIN" || !ctx.permissions.has("communications.view")) throw new AppError("FORBIDDEN");
  return GROUPS[ctx.user.role] ?? ["APPOINTMENT", "FOLLOWUP"]; // an individually granted STAFF member sees the everyday groups only
}
const eventsOf = (groups: StaffGroup[]) => EVENT_TYPES.filter((e) => groups.includes(EVENTS[e].group));
const canSeeText = (ctx: TenantRequestContext) => ctx.user.role === "CLINIC_ADMIN" || ctx.user.role === "RECEPTIONIST";
const configGuard = (ctx: TenantRequestContext) => { if (ctx.user.role === "SUPER_ADMIN" || !ctx.permissions.has("communications.configure")) throw new AppError("FORBIDDEN"); };
const templateGuard = (ctx: TenantRequestContext) => { if (ctx.user.role === "SUPER_ADMIN" || !ctx.permissions.has("communications.templates")) throw new AppError("FORBIDDEN"); };

export const maskRecipient = (r: string) => (r.includes("@") ? r.replace(/^(.).*(@.*)$/, "$1•••$2") : r.length > 4 ? `${"•".repeat(Math.max(0, r.length - 4))}${r.slice(-4)}` : "••••");

/* ------------------------------------------------ settings ------------------------------------------------ */
export async function getCommSettingsView(ctx: TenantRequestContext) {
  if (ctx.user.role === "SUPER_ADMIN" || !(ctx.permissions.has("communications.configure") || ctx.permissions.has("communications.view"))) throw new AppError("FORBIDDEN");
  const s = await loadSettings(ctx.tenantId);
  const providers = CHANNELS.map((c) => { const p = providerStatus(c); return { channel: c, provider: p.provider, configured: p.configured, webhookReady: p.webhookReady, hint: p.hint }; }); // never credentials
  const t = await loadTenantProfile(ctx.tenantId);
  return { settings: s, providers, canConfigure: ctx.permissions.has("communications.configure"), clinicName: t?.name ?? "", clinicEmail: t?.email ?? null, timezone: t?.timezone ?? "Asia/Kolkata", events: EVENT_TYPES.map((e) => ({ key: e, label: EVENTS[e].label, description: EVENTS[e].description, category: EVENTS[e].category, defaultOn: EVENTS[e].defaultOn, enabled: s.eventToggles[e] ?? EVENTS[e].defaultOn })) };
}
export async function saveCommSettings(ctx: TenantRequestContext, raw: unknown) {
  configGuard(ctx); const v = parseOrThrow(commSettingsSchema, raw); const tdb = db(ctx); const cur = await loadSettings(ctx.tenantId);
  const data = { whatsappEnabled: v.whatsappEnabled, smsEnabled: v.smsEnabled, emailEnabled: v.emailEnabled, channelOrder: JSON.stringify(v.channelOrder), senderName: v.senderName, replyTo: v.replyTo, defaultLanguage: v.defaultLanguage, eventToggles: JSON.stringify(v.eventToggles), reminderOffsets: JSON.stringify([...v.reminderOffsets].sort((a, b) => b - a)), quietEnabled: v.quietEnabled, quietStartMin: v.quietStartMin, quietEndMin: v.quietEndMin, fallbackRules: JSON.stringify(v.fallbackRules), maxRetries: v.maxRetries, dailyCapPerPatient: v.dailyCapPerPatient };
  await tdb.communicationSettings.upsert({ where: { tenantId: ctx.tenantId }, update: data, create: { tenantId: ctx.tenantId, ...data } });
  const next = toSettings(data); const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(cur[k]));
  await recordAudit({ action: AUDIT_ACTIONS.COMM_SETTINGS_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "communication_settings", entityId: ctx.tenantId, metadata: { fields: changed } });
  return loadSettings(ctx.tenantId);
}

/* ------------------------------------------------ templates ------------------------------------------------ */
export async function listTemplates(ctx: TenantRequestContext) {
  if (ctx.user.role === "SUPER_ADMIN" || !(ctx.permissions.has("communications.templates") || ctx.permissions.has("communications.view"))) throw new AppError("FORBIDDEN");
  const rows = (await db(ctx).communicationTemplate.findMany({ orderBy: [{ eventType: "asc" }, { channel: "asc" }, { language: "asc" }], take: 500 })) as Record<string, any>[];
  return {
    canEdit: ctx.permissions.has("communications.templates"),
    templates: rows.map((r) => ({ id: r.id as string, channel: r.channel as Channel, eventType: r.eventType as string, name: r.name as string, language: r.language as Language, subject: (r.subject ?? null) as string | null, body: r.body as string, providerTemplateId: (r.providerTemplateId ?? null) as string | null, status: r.status as string, isDefault: !!r.isDefault, variables: parse<string[]>(r.variables, []), updatedAt: (r.updatedAt as Date).toISOString() })),
    builtin: EVENT_TYPES.map((e) => ({ eventType: e, label: EVENTS[e].label, category: EVENTS[e].category, languages: builtinLanguages(e), text: builtinText(e, "en")!.text, subject: builtinText(e, "en")!.subject })),
    variables: Object.entries(VARIABLES).map(([name, description]) => ({ name, description })), limits: LIMITS,
  };
}
async function writeTemplate(ctx: TenantRequestContext, id: string | null, raw: unknown) {
  templateGuard(ctx); const v = parseOrThrow(templateSchema, raw); const tdb = db(ctx);
  const problems = validateTemplate({ channel: v.channel, subject: v.subject, body: v.body, providerTemplateId: v.providerTemplateId });
  if (problems.length) throw new AppError("VALIDATION_ERROR", { message: problems[0], fieldErrors: { body: problems.join(" ") } });
  const vars = v.variables?.length ? v.variables.filter((n) => n in VARIABLES) : [...new Set(usedVariables(v.body))];
  const data = { channel: v.channel, eventType: v.eventType, name: v.name, language: v.language, subject: v.subject, body: v.body.trim(), providerTemplateId: v.providerTemplateId, variables: JSON.stringify(vars), isDefault: !!v.isDefault };
  try {
    if (id) {
      const cur = await tdb.communicationTemplate.findFirst({ where: { id } }); if (!cur) throw new AppError("NOT_FOUND", { message: "Template not found." });
      // editing an ACTIVE template sends it back to DRAFT: what patients receive changes only through an explicit activation
      const row = await tdb.communicationTemplate.update({ where: { id }, data: { ...data, ...(cur.status === "ACTIVE" ? { status: "DRAFT" } : {}) } });
      await recordAudit({ action: AUDIT_ACTIONS.COMM_TEMPLATE_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "communication_template", entityId: id, metadata: { channel: v.channel, event: v.eventType, language: v.language } });
      return { id: row.id as string, status: row.status as string };
    }
    const row = await tdb.communicationTemplate.create({ data: { tenantId: ctx.tenantId, ...data, status: "DRAFT", createdById: ctx.user.id } });
    await recordAudit({ action: AUDIT_ACTIONS.COMM_TEMPLATE_CREATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "communication_template", entityId: row.id, metadata: { channel: v.channel, event: v.eventType, language: v.language } });
    return { id: row.id as string, status: "DRAFT" };
  } catch (e) { if ((e as { code?: string })?.code === "P2002") throw new AppError("CONFLICT", { message: "A template with this name already exists for that notification, channel and language." }); throw e; }
}
export const createTemplate = (ctx: TenantRequestContext, raw: unknown) => writeTemplate(ctx, null, raw);
export const updateTemplate = (ctx: TenantRequestContext, id: string, raw: unknown) => writeTemplate(ctx, id, raw);

export async function setTemplateStatus(ctx: TenantRequestContext, id: string, raw: unknown) {
  templateGuard(ctx); const { status } = parseOrThrow(templateStatusSchema, raw); const tdb = db(ctx);
  const t = await tdb.communicationTemplate.findFirst({ where: { id } }); if (!t) throw new AppError("NOT_FOUND", { message: "Template not found." });
  if (status === "ACTIVE") {
    const problems = validateTemplate({ channel: t.channel, subject: t.subject, body: t.body, providerTemplateId: t.providerTemplateId, status: "ACTIVE" });
    if (problems.length) throw new AppError("VALIDATION_ERROR", { message: problems[0] });
    // one live template per notification + channel + language
    await tdb.communicationTemplate.updateMany({ where: { channel: t.channel, eventType: t.eventType, language: t.language, status: "ACTIVE", id: { not: id } }, data: { status: "INACTIVE" } });
  }
  await tdb.communicationTemplate.update({ where: { id }, data: { status } });
  await recordAudit({ action: status === "ACTIVE" ? AUDIT_ACTIONS.COMM_TEMPLATE_ACTIVATED : AUDIT_ACTIONS.COMM_TEMPLATE_DISABLED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "communication_template", entityId: id, metadata: { status, channel: t.channel, event: t.eventType } });
  return { status };
}

/** Preview with SYNTHETIC data only. Nothing is ever sent from here. */
export async function previewTemplate(ctx: TenantRequestContext, raw: unknown) {
  if (ctx.user.role === "SUPER_ADMIN" || !(ctx.permissions.has("communications.templates") || ctx.permissions.has("communications.configure"))) throw new AppError("FORBIDDEN");
  const lim = await rateLimit(`comm:preview:${ctx.user.id}`, { limit: 60, windowMs: 60_000 }); if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const v = parseOrThrow(previewSchema, raw); const t = await loadTenantProfile(ctx.tenantId);
  const problems = validateTemplate({ channel: v.channel, subject: v.subject, body: v.body });
  const vars = { ...SAMPLE_VARS, clinic_name: t?.name ?? SAMPLE_VARS.clinic_name, clinic_phone: t?.phone ?? SAMPLE_VARS.clinic_phone, clinic_address: t?.address || SAMPLE_VARS.clinic_address };
  const body = renderTemplate(v.body, vars); const subject = v.subject ? renderTemplate(v.subject, vars) : null;
  const email = v.channel === "EMAIL" && t ? renderEmailHtml(t, { subject: subject ?? "", text: body, link: vars.portal_link, senderName: (await loadSettings(ctx.tenantId)).senderName }) : null;
  return { problems, subject, body, length: body.length, limit: LIMITS[v.channel].body, html: email?.html ?? null, sample: true, whatsappNote: v.channel === "WHATSAPP" ? "WhatsApp messages sent automatically must use a template approved by your provider. Submit this text for approval, then enter the approved template name." : null };
}

/* ------------------------------------------------ message log ------------------------------------------------ */
export interface MessageRow { id: string; createdAt: string; channel: Channel; event: string; eventLabel: string; status: string; provider: string | null; patient: { id: string; name: string; code: string } | null; recipient: string; failureCode: string | null; failureReason: string | null; attempts: number; entityType: string | null; entityId: string | null; priority: string; category: string }
function toRow(m: Record<string, any>, patients: Map<string, { id: string; name: string; code: string }>): MessageRow {
  return { id: m.id, createdAt: m.createdAt.toISOString(), channel: m.channel, event: m.eventType, eventLabel: (EVENTS as Record<string, { label: string }>)[m.eventType]?.label ?? m.eventType, status: m.status, provider: m.provider ?? null, patient: m.patientId ? patients.get(m.patientId) ?? null : null, recipient: maskRecipient(m.recipient), failureCode: m.failureCode ?? null, failureReason: m.status === "SKIPPED" ? skipReasonText(m.failureCode) : m.failureReason ?? null, attempts: m.attempts, entityType: m.entityType ?? null, entityId: m.entityId ?? null, priority: m.priority, category: m.category };
}
async function patientMap(tdb: Client, ids: (string | null)[]) {
  const list = [...new Set(ids.filter(Boolean))] as string[];
  const rows = list.length ? await tdb.patient.findMany({ where: { id: { in: list } }, select: { id: true, name: true, code: true } }) : [];
  return new Map<string, { id: string; name: string; code: string }>(rows.map((p: { id: string; name: string; code: string }) => [p.id, p]));
}
export async function listMessages(ctx: TenantRequestContext, raw: Record<string, unknown> = {}) {
  const groups = viewGuard(ctx); const q = parseOrThrow(messageQuerySchema, raw); const tdb = db(ctx); const page = q.page ?? 1;
  const where: Record<string, unknown> = { eventType: { in: eventsOf(groups) } };
  if (q.channel) where.channel = q.channel; if (q.status) where.status = q.status; if (q.provider) where.provider = q.provider; if (q.patientId) where.patientId = q.patientId;
  if (q.event) { if (!(eventsOf(groups) as string[]).includes(q.event)) return { rows: [] as MessageRow[], total: 0, page, pageSize: PAGE }; where.eventType = q.event; }
  if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lt: new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000) } : {}) };
  if (q.q) { const pts = (await tdb.patient.findMany({ where: { OR: [{ name: containsCI(q.q) }, { code: containsCI(q.q) }] }, select: { id: true }, take: 100 })) as { id: string }[]; where.patientId = { in: pts.map((p) => p.id) }; }
  const [total, rows] = await Promise.all([tdb.communicationMessage.count({ where }), tdb.communicationMessage.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE })]);
  const pm = await patientMap(tdb, rows.map((r: { patientId: string | null }) => r.patientId));
  return { rows: rows.map((r: Record<string, any>) => toRow(r, pm)) as MessageRow[], total: total as number, page, pageSize: PAGE };
}
export async function getMessage(ctx: TenantRequestContext, id: string) {
  const groups = viewGuard(ctx); const tdb = db(ctx);
  const m = await tdb.communicationMessage.findFirst({ where: { id, eventType: { in: eventsOf(groups) } }, include: { attemptsLog: { orderBy: { createdAt: "asc" }, take: 60 } } });
  if (!m) throw new AppError("NOT_FOUND", { message: "Message not found." });
  const pm = await patientMap(tdb, [m.patientId]); const tpl = m.templateId ? await tdb.communicationTemplate.findFirst({ where: { id: m.templateId }, select: { name: true } }) : null;
  const isoOrNull = (d: Date | null) => d?.toISOString() ?? null;
  return {
    ...toRow(m, pm), language: m.language as string, template: (tpl?.name ?? (m.templateId ? "Clinic template" : "Built-in text")) as string, providerMessageId: (m.providerMessageId ?? null) as string | null,
    scheduledAt: m.scheduledAt.toISOString(), sentAt: isoOrNull(m.sentAt), deliveredAt: isoOrNull(m.deliveredAt), readAt: isoOrNull(m.readAt), failedAt: isoOrNull(m.failedAt), maxAttempts: m.maxAttempts as number,
    preview: canSeeText(ctx) && m.body ? String(m.body).slice(0, 160) : null, resendable: canResend(ctx, m),
    history: (m.attemptsLog as Record<string, any>[]).map((a) => ({ at: a.createdAt.toISOString(), status: a.status as string, source: a.source as string, code: (a.code ?? null) as string | null, note: (a.note ?? null) as string | null })),
  };
}
function canResend(ctx: TenantRequestContext, m: Record<string, any>) {
  const ev = (EVENTS as Record<string, { resendable: boolean }>)[m.eventType];
  return ctx.permissions.has("communications.resend") && !!ev?.resendable && m.category === "TRANSACTIONAL" && ["FAILED", "SKIPPED", "CANCELLED", "SENT", "DELIVERED", "READ"].includes(m.status);
}
export async function commStats(ctx: TenantRequestContext, days = 7) {
  const groups = viewGuard(ctx); const tdb = db(ctx); const since = new Date(Date.now() - Math.min(90, Math.max(1, days)) * 86_400_000);
  const where = { createdAt: { gte: since }, eventType: { in: eventsOf(groups) } };
  const [byStatus, byChannel] = await Promise.all([tdb.communicationMessage.groupBy({ by: ["status"], where, _count: { _all: true } }), tdb.communicationMessage.groupBy({ by: ["channel", "status"], where, _count: { _all: true } })]);
  const n = (st: string[]) => (byStatus as { status: string; _count: { _all: number } }[]).filter((x) => st.includes(x.status)).reduce((a, x) => a + x._count._all, 0);
  const ch = (c: Channel) => (byChannel as { channel: string; status: string; _count: { _all: number } }[]).filter((x) => x.channel === c && x.status !== "SKIPPED").reduce((a, x) => a + x._count._all, 0);
  return { days, total: n(["QUEUED", "PROCESSING", "RETRYING", "SENT", "DELIVERED", "READ", "FAILED", "CANCELLED"]), sent: n(["SENT", "DELIVERED", "READ"]), delivered: n(["DELIVERED", "READ"]), failed: n(["FAILED"]), pending: n(["QUEUED", "PROCESSING"]), retrying: n(["RETRYING"]), skipped: n(["SKIPPED"]), channels: { WHATSAPP: ch("WHATSAPP"), SMS: ch("SMS"), EMAIL: ch("EMAIL") } };
}

/* ------------------------------------------------ resend ------------------------------------------------ */
const MAX_RESENDS = 3;
/** Authorised staff re-send a TRANSACTIONAL message. Goes through the same consent / provider / template rules as the original and creates a NEW attempt (the old row is kept). */
export async function resendMessage(ctx: TenantRequestContext, id: string) {
  viewGuard(ctx); if (!ctx.permissions.has("communications.resend")) throw new AppError("FORBIDDEN");
  const lim = await rateLimit(`comm:resend:${ctx.user.id}`, { limit: 20, windowMs: 60 * 60_000 }); if (!lim.allowed) throw new AppError("RATE_LIMITED", { message: "Too many resends. Please wait a while." });
  const tdb = db(ctx); const m = await tdb.communicationMessage.findFirst({ where: { id } });
  if (!m) throw new AppError("NOT_FOUND", { message: "Message not found." });
  if (!canResend(ctx, m)) throw new AppError("FORBIDDEN", { message: "This message can't be resent." });
  const root = m.resendOfId ?? m.id; const used = await tdb.communicationMessage.count({ where: { OR: [{ id: root }, { resendOfId: root }] } });
  if (used - 1 >= MAX_RESENDS) throw new AppError("CONFLICT", { message: `This message was already resent ${MAX_RESENDS} times.` });
  const c = parse<{ eventKey?: string; vars?: Record<string, string>; linkPath?: string | null }>(m.context, {});
  const base = await tdb.communicationMessage.findFirst({ where: { id: root }, select: { context: true } }); const bc = parse<{ eventKey?: string }>(base?.context, c);
  const eventKey = c.eventKey ?? bc.eventKey; if (!eventKey) throw new AppError("CONFLICT", { message: "This message can't be rebuilt, so it can't be resent." });
  const r = await emitCommunication({ tenantId: ctx.tenantId, event: m.eventType as EventType, patientId: m.patientId, eventKey, entityType: m.entityType ?? undefined, entityId: m.entityId ?? undefined, vars: c.vars, linkPath: c.linkPath ?? undefined, resendOfId: root, createdById: ctx.user.id, ignoreToggle: true });
  await recordAudit({ action: AUDIT_ACTIONS.COMM_MESSAGE_RESENT, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "communication_message", entityId: id, metadata: { event: m.eventType, queued: r.queued.length, skipped: r.skipped } });
  if (r.queued.length) { const { kickQueue } = await import("@/lib/communications/dispatch"); kickQueue(); }
  return { queued: r.queued.length, skipped: r.skipped ? skipReasonText(r.skipped) : null };
}

/* ------------------------------------------------ per-entity / per-patient status (appointment page, patient 360) ------------------------------------------------ */
export async function entityComms(ctx: TenantRequestContext, q: { entityType?: string; entityId?: string; patientId?: string }) {
  const groups = viewGuard(ctx); const tdb = db(ctx);
  if (!q.entityId && !q.patientId) throw new AppError("VALIDATION_ERROR", { message: "Nothing to look up." });
  const where: Record<string, unknown> = { eventType: { in: eventsOf(groups) }, status: { not: "SKIPPED" }, ...(q.entityId ? { entityType: q.entityType ?? "appointment", entityId: q.entityId } : { patientId: q.patientId }) };
  const rows = (await tdb.communicationMessage.findMany({ where, orderBy: { createdAt: "desc" }, take: 20 })) as Record<string, any>[];
  return { rows: rows.map((m) => ({ id: m.id as string, at: m.createdAt.toISOString() as string, channel: m.channel as Channel, eventLabel: ((EVENTS as Record<string, { label: string }>)[m.eventType]?.label ?? m.eventType) as string, status: m.status as string, failureReason: m.status === "FAILED" ? "Could not be delivered" : null })) };
}
