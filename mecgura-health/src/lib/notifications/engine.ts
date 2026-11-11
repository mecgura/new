import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { cleanValue } from "@/lib/communications/template-engine";
import { utcToZoned, zonedToUtc, addDays } from "@/lib/scheduling/time";
import { PRIORITIES, PRIORITY_RANK, MAX_RULE_PRIORITY, TYPES, def, safeActionUrl, staffHref, type NCategory, type NPriority, type NType } from "./catalog";

export interface NotifyInput {
  /** null = platform-level alert (Super Admins) */
  tenantId: string | null; type: NType;
  /** idempotency: the same event can notify the same person only once, even if it is reported twice */
  eventKey: string; entityType?: string; entityId?: string; patientId?: string | null;
  vars?: Record<string, unknown>;
  doctorUserId?: string | null; assigneeUserId?: string | null; selfUserId?: string | null; actorUserId?: string | null;
  actionUrl?: string | null; priority?: NPriority; groupKey?: string; expiresAt?: Date;
  /** for patient recipients: use this dedupe key (shares the key scheme of the portal's own sync so a record can never appear twice) */
  patientDedupeKey?: string;
}
export interface NotifyResult { created: number; grouped: number; skipped: number }

const parse = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };
const PATIENT_PREF: Partial<Record<NCategory, string>> = { APPOINTMENT: "appointments", OPD: "appointments", LAB: "reports", CLINICAL: "reports", FOLLOWUP: "followUps", BILLING: "billing" };

export async function loadRule(tenantId: string | null, type: NType) {
  if (!tenantId) return null;
  return db.notificationRule.findUnique({ where: { tenantId_type: { tenantId, type } } });
}
/** Effective priority: built-in, optionally changed by the clinic's rule (never above URGENT unless the built-in type is already CRITICAL). */
export function effectivePriority(type: NType, rule: { priority: string | null } | null, override?: NPriority): NPriority {
  const base = TYPES[type].priority as NPriority; const want = (override ?? rule?.priority ?? base) as NPriority;
  if (!(PRIORITIES as readonly string[]).includes(want)) return base;
  if (PRIORITY_RANK[want] > PRIORITY_RANK[MAX_RULE_PRIORITY] && base !== "CRITICAL") return MAX_RULE_PRIORITY;
  return base === "CRITICAL" ? "CRITICAL" : want;
}

interface Recipient { userId: string; patient: boolean; tz?: string }
async function resolveRecipients(i: NotifyInput, tokens: string[], tz: string): Promise<Recipient[]> {
  const out = new Map<string, Recipient>(); const roles: string[] = [];
  for (const tok of tokens) {
    if (tok === "@doctor") { if (i.doctorUserId) out.set(i.doctorUserId, { userId: i.doctorUserId, patient: false, tz }); }
    else if (tok === "@assignee") { if (i.assigneeUserId) out.set(i.assigneeUserId, { userId: i.assigneeUserId, patient: false, tz }); }
    else if (tok === "@self") { if (i.selfUserId) out.set(i.selfUserId, { userId: i.selfUserId, patient: false, tz }); }
    else if (tok === "@patient") {
      if (i.tenantId && i.patientId) { const a = await db.patientAccount.findFirst({ where: { tenantId: i.tenantId, patientId: i.patientId, status: "ACTIVE" }, select: { userId: true } }); if (a) out.set(a.userId, { userId: a.userId, patient: true, tz }); }
    } else roles.push(tok);
  }
  const staffRoles = roles.filter((r) => r !== "SUPER_ADMIN"); 
  if (staffRoles.length && i.tenantId) { const rows = await db.user.findMany({ where: { tenantId: i.tenantId, status: "ACTIVE", deletedAt: null, role: { key: { in: staffRoles } } }, select: { id: true } }); for (const r of rows) out.set(r.id, { userId: r.id, patient: false, tz }); }
  if (roles.includes("SUPER_ADMIN")) { const rows = await db.user.findMany({ where: { tenantId: null, status: "ACTIVE", deletedAt: null, role: { key: "SUPER_ADMIN" } }, select: { id: true } }); for (const r of rows) out.set(r.id, { userId: r.id, patient: false, tz: "Asia/Kolkata" }); }
  // a person is never notified about their own action (except security notices about themselves)
  if (i.actorUserId && !tokens.includes("@self")) out.delete(i.actorUserId);
  return [...out.values()];
}

/** Quiet hours (per user, in the CLINIC's time zone). LOW / NORMAL are held until the window ends; HIGH and above are never held. */
export function visibleAtFor(s: { quietEnabled: boolean; quietStartMin: number; quietEndMin: number } | null, tz: string, priority: NPriority, now: Date): Date {
  if (!s?.quietEnabled || PRIORITY_RANK[priority] >= PRIORITY_RANK.HIGH || s.quietStartMin === s.quietEndMin) return now;
  const z = utcToZoned(now, tz); const a = s.quietStartMin, b = s.quietEndMin;
  const inside = a < b ? z.minutes >= a && z.minutes < b : z.minutes >= a || z.minutes < b; if (!inside) return now;
  return zonedToUtc(a < b || z.minutes < b ? z.date : addDays(z.date, 1), b, tz);
}

const clean = (v: Record<string, unknown> | undefined) => Object.fromEntries(Object.entries(v ?? {}).map(([k, x]) => [k, cleanValue(x, true)]));

/** The single entry point for in-app notifications. Never throws to the caller (see `safeNotify`). */
export async function notify(i: NotifyInput): Promise<NotifyResult> {
  const d = TYPES[i.type] as ReturnType<typeof def> & object; const res: NotifyResult = { created: 0, grouped: 0, skipped: 0 };
  const rule = await loadRule(i.tenantId, i.type);
  if (rule ? !rule.enabled || !rule.inApp : !d.defaultOn) return res;
  const tokens = rule && parse<string[]>(rule.roles, []).length ? parse<string[]>(rule.roles, []) : [...d.audience];
  const tenant = i.tenantId ? await db.tenant.findUnique({ where: { id: i.tenantId }, select: { timezone: true, status: true, deletedAt: true } }) : null;
  if (i.tenantId && (!tenant || tenant.deletedAt || !["ACTIVE", "TRIAL"].includes(tenant.status))) return res;
  const tz = tenant?.timezone ?? "Asia/Kolkata"; const priority = effectivePriority(i.type, rule, i.priority); const ackRequired = rule?.ackRequired ?? !!d.ack; const now = new Date();
  const v = clean(i.vars); const title = d.title(v).slice(0, 160); const body = d.message(v).slice(0, 400);
  const recipients = await resolveRecipients(i, tokens, tz);
  const staffAction = safeActionUrl(i.actionUrl !== undefined ? i.actionUrl : staffHref(i.entityType, i.entityId, i.patientId));
  for (const r of recipients) {
    const dedupeKey = r.patient && i.patientDedupeKey ? i.patientDedupeKey : null;
    // 1) the recipient's own switches (security notices and urgent ones cannot be switched off)
    const critical = d.category === "SECURITY" || PRIORITY_RANK[priority] >= PRIORITY_RANK.URGENT;
    if (!critical) {
      if (r.patient) { const acc = await db.patientAccount.findFirst({ where: { userId: r.userId }, select: { prefs: true } }); const key = PATIENT_PREF[d.category]; if (key && parse<Record<string, unknown>>(acc?.prefs, {})[key] === false) { res.skipped++; continue; } }
      else { const p = await db.notificationPreference.findUnique({ where: { userId_category: { userId: r.userId, category: d.category } } }); if (p && !p.inApp) { res.skipped++; continue; } }
    }
    // 2) idempotency ledger
    try { await db.notificationEvent.create({ data: { userId: r.userId, eventKey: i.eventKey } }); } catch (e) { if ((e as { code?: string })?.code === "P2002") { res.skipped++; continue; } throw e; }
    const us = r.patient ? null : await db.notificationUserSettings.findUnique({ where: { userId: r.userId } });
    const visibleAt = visibleAtFor(us, tz, priority, now);
    const actionUrl = r.patient ? safeActionUrl(i.actionUrl) : staffAction;
    // 3) grouping (never for security / urgent / acknowledgement-required items)
    if (d.group && i.groupKey && !critical && !ackRequired) {
      const g = await db.notification.findFirst({ where: { userId: r.userId, groupKey: i.groupKey, readAt: null, archivedAt: null, ackRequired: false }, orderBy: { createdAt: "desc" } });
      if (g) { const n = g.groupCount + 1; await db.notification.update({ where: { id: g.id }, data: { groupCount: n, title: `${n} patients have checked in`, body: "Open the live queue to see who is waiting.", createdAt: now, actionUrl: "/opd" } }); res.grouped++; continue; }
    }
    try {
      await db.notification.create({ data: { tenantId: i.tenantId, userId: r.userId, type: i.type, category: d.category, priority, title, body, actionUrl, entityType: i.entityType ?? null, entityId: i.entityId ?? null, patientId: i.patientId ?? null, visibleAt, ackRequired, expiresAt: i.expiresAt ?? null, sourceEventId: i.eventKey, groupKey: i.groupKey ?? null, dedupeKey } });
      res.created++;
    } catch (e) { if ((e as { code?: string })?.code === "P2002") res.skipped++; else throw e; }
  }
  if (res.created && (PRIORITY_RANK[priority] >= PRIORITY_RANK.HIGH || ackRequired)) await recordAudit({ action: AUDIT_ACTIONS.NOTIFICATION_CREATED, tenantId: i.tenantId, entityType: i.entityType ?? "notification", entityId: i.entityId ?? undefined, metadata: { type: i.type, priority, recipients: res.created } });
  return res;
}

/** What business modules call. A notification problem can never fail the clinical or billing action that raised it. */
export async function safeNotify(i: NotifyInput): Promise<NotifyResult | null> {
  try { return await notify(i); } catch (err) { logger.error("notification failed", { type: i.type, error: err }); return null; }
}
