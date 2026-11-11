import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { COLLECTIBLE, dueOf } from "@/lib/billing/money";
import { loadSettings } from "@/lib/communications/settings";
import { addDays, dayRangeUtc, todayIn } from "@/lib/scheduling/time";
import { tenantDb } from "@/lib/tenant/db";
import { loadPharmacySettings, sellableStock, stockStatus } from "@/lib/services/pharmacy-core";
import { notifyAppointmentReminder } from "./events";
import { safeNotify } from "./engine";

/**
 * Background work of the notification centre. It rides the SAME scheduler tick as Phase 11 (`/api/internal/communications/run`) — there is no second scheduler.
 * Every job is idempotent (deterministic event keys), so a double run or a late run can't duplicate anything.
 */
const OPEN_FU = ["PENDING", "DUE", "IN_PROGRESS", "CONTACTED"];
export interface JobSummary { tenants: number; reminders: number; digests: number; stock: number; escalated: number; archived: number; alerts: number }

async function tenantJobs(tenantId: string, tz: string, now: Date, sum: JobSummary) {
  const today = todayIn(tz, now); const tomorrow = addDays(today, 1); const cs = await loadSettings(tenantId);
  // 1) patient in-app reminders (work with every external channel switched off)
  for (const offset of cs.reminderOffsets) {
    const rows = await db.appointment.findMany({ where: { tenantId, status: "CONFIRMED", patientId: { not: null }, startsAt: { gt: new Date(now.getTime() + (offset / 2) * 60_000), lte: new Date(now.getTime() + offset * 60_000) } }, select: { id: true, createdAt: true, startsAt: true, type: true }, take: 300 });
    for (const a of rows) { if (a.createdAt.getTime() > a.startsAt.getTime() - offset * 60_000 || ["WALK_IN", "EMERGENCY"].includes(a.type)) continue; await notifyAppointmentReminder(tenantId, a.id, offset); sum.reminders++; }
  }
  const fus = await db.followUp.findMany({ where: { tenantId, status: { in: OPEN_FU }, dueDate: { gte: today, lte: tomorrow } }, select: { id: true, patientId: true, dueDate: true }, take: 300 });
  for (const f of fus) { const r = await safeNotify({ tenantId, type: "FOLLOWUP_REMINDER", eventKey: `fu:${f.id}:rem:${f.dueDate}`, entityType: "followup", entityId: f.id, patientId: f.patientId, actionUrl: "/portal/follow-ups", patientDedupeKey: `followup:${f.id}`, vars: { date: f.dueDate } }); if (r?.created) sum.reminders++; }
  // 2) daily admin notes (counts of real rows; nothing when the count is zero)
  const overdueFu = await db.followUp.count({ where: { tenantId, status: { in: OPEN_FU }, dueDate: { lt: today } } });
  if (overdueFu) { const r = await safeNotify({ tenantId, type: "FOLLOWUP_OVERDUE", eventKey: `fu-overdue:${tenantId}:${today}`, entityType: "followup", actionUrl: "/followups", vars: { count: String(overdueFu) } }); if (r?.created) sum.digests++; }
  const inv = await db.invoice.findMany({ where: { tenantId, status: { in: [...COLLECTIBLE] }, dueDate: { lt: today } }, select: { totalMinor: true, collectedMinor: true, refundedMinor: true, status: true }, take: 2000 });
  const overdueInv = inv.filter((i) => dueOf(i as never) > 0).length;
  if (overdueInv) { const r = await safeNotify({ tenantId, type: "INVOICE_OVERDUE", eventKey: `inv-overdue:${tenantId}:${today}`, entityType: "invoice", actionUrl: "/billing/outstanding", vars: { count: String(overdueInv) } }); if (r?.created) sum.digests++; }
  // 3) pharmacy stock
  const ns = await db.notificationSettings.findUnique({ where: { tenantId } });
  if (ns?.lowStockCheck ?? true) {
    const tdb = tenantDb({ tenantId }) as never as Parameters<typeof sellableStock>[0]; const ps = await loadPharmacySettings(tdb, tenantId); const near = addDays(today, ps.nearExpiryDays);
    const meds = (await (tdb as any).medicine.findMany({ where: { active: true }, select: { id: true, reorderLevel: true, minimumStock: true } })) as { id: string; reorderLevel: number; minimumStock: number }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (meds.length) {
      const stock = await sellableStock(tdb, today); let low = 0, out = 0;
      for (const m of meds) { const st = stockStatus(stock.get(m.id) ?? 0, m); if (st === "LOW_STOCK") low++; else if (st === "OUT_OF_STOCK") out++; }
      const [exp, expired] = await Promise.all([db.medicineBatch.count({ where: { tenantId, expiryDate: { gte: today, lte: near }, quantityAvailable: { gt: 0 }, status: "ACTIVE" } }), db.medicineBatch.count({ where: { tenantId, expiryDate: { lt: today }, quantityAvailable: { gt: 0 } } })]);
      const k = (t: string) => `stock:${t}:${tenantId}:${today}`;
      if (low) sum.stock += (await safeNotify({ tenantId, type: "STOCK_LOW", eventKey: k("low"), entityType: "stock", actionUrl: "/pharmacy/stock", vars: { count: String(low) } }))?.created ?? 0;
      if (out) sum.stock += (await safeNotify({ tenantId, type: "STOCK_OUT", eventKey: k("out"), entityType: "stock", actionUrl: "/pharmacy/stock", vars: { count: String(out) } }))?.created ?? 0;
      if (exp) sum.stock += (await safeNotify({ tenantId, type: "BATCH_EXPIRING", eventKey: k("exp"), entityType: "expiry", actionUrl: "/pharmacy/expiry", vars: { count: String(exp), days: String(ps.nearExpiryDays) } }))?.created ?? 0;
      if (expired) sum.stock += (await safeNotify({ tenantId, type: "BATCH_EXPIRED", eventKey: k("expired"), entityType: "expiry", actionUrl: "/pharmacy/expiry", vars: { count: String(expired) } }))?.created ?? 0;
    }
  }
  // 4) messaging provider problems: several permanent provider-side failures in the last hour
  const since = new Date(now.getTime() - 3_600_000);
  const fails = await db.communicationMessage.groupBy({ by: ["channel", "failureCode"], where: { tenantId, status: "FAILED", failedAt: { gte: since }, failureCode: { in: ["HTTP_401", "HTTP_403", "NO_APPROVED_TEMPLATE", "PROVIDER_NOT_CONFIGURED", "NETWORK_ERROR", "TIMEOUT"] } }, _count: { _all: true } });
  for (const f of fails) if (f._count._all >= 3) { const r = await safeNotify({ tenantId, type: "PROVIDER_FAILURE", eventKey: `provfail:${tenantId}:${f.channel}:${f.failureCode}:${now.toISOString().slice(0, 13)}`, entityType: "communications", actionUrl: "/communications", vars: { count: String(f._count._all), channel: f.channel.toLowerCase(), code: f.failureCode ?? "" } }); if (r?.created) sum.alerts++; }
  // 5) escalation: important notifications nobody acknowledged in time -> tell the clinic admin ONCE
  const rules = await db.notificationRule.findMany({ where: { tenantId, escalateAfterMin: { not: null } } });
  for (const r of rules) {
    const due = await db.notification.findMany({ where: { tenantId, type: r.type, ackRequired: true, acknowledgedAt: null, escalatedAt: null, visibleAt: { lte: new Date(now.getTime() - (r.escalateAfterMin ?? 0) * 60_000) } }, take: 100 });
    for (const n of due) {
      const claim = await db.notification.updateMany({ where: { id: n.id, escalatedAt: null }, data: { escalatedAt: now } }); if (claim.count !== 1) continue;
      const u = await db.user.findUnique({ where: { id: n.userId }, select: { name: true } });
      await safeNotify({ tenantId, type: "NOTIFICATION_ESCALATED", eventKey: `esc:${n.id}`, entityType: n.entityType ?? undefined, entityId: n.entityId ?? undefined, patientId: n.patientId, actionUrl: n.actionUrl, vars: { what: n.title, who: u?.name ?? "The recipient", minutes: String(r.escalateAfterMin) } });
      sum.escalated++;
    }
  }
  // 6) retention — only when the clinic switched it on; never touches security / critical / unacknowledged items; nothing is deleted
  if (ns?.retentionEnabled) {
    const keep = { category: { not: "SECURITY" }, priority: { notIn: ["CRITICAL"] }, OR: [{ ackRequired: false }, { acknowledgedAt: { not: null } }] };
    const a = await db.notification.updateMany({ where: { tenantId, ...keep, readAt: { lte: new Date(now.getTime() - ns.archiveReadAfterDays * 86_400_000) }, archivedAt: null }, data: { archivedAt: now } });
    const e = await db.notification.updateMany({ where: { tenantId, ...keep, archivedAt: { lte: new Date(now.getTime() - (ns.expireAfterDays - ns.archiveReadAfterDays) * 86_400_000) }, expiresAt: null }, data: { expiresAt: now } });
    sum.archived += a.count + e.count;
  }
  // 7) daily digest for people who opted in — real numbers only
  const optIn = await db.notificationUserSettings.findMany({ where: { tenantId, digestEnabled: true }, select: { userId: true } });
  for (const o of optIn) { const text = await digestText(tenantId, o.userId, today, tz); if (text) { const r = await safeNotify({ tenantId, type: "DAILY_DIGEST", eventKey: `digest:${o.userId}:${today}`, selfUserId: o.userId, vars: { summary: text }, actionUrl: "/dashboard" }); if (r?.created) sum.digests++; } }
}
async function digestText(tenantId: string, userId: string, today: string, tz: string): Promise<string | null> {
  const u = await db.user.findFirst({ where: { id: userId, tenantId, status: "ACTIVE" }, select: { role: { select: { key: true } } } }); if (!u) return null;
  const { start, end } = dayRangeUtc(today, tz); const own = u.role.key === "DOCTOR"; const parts: string[] = [];
  if (["DOCTOR", "RECEPTIONIST", "CLINIC_ADMIN"].includes(u.role.key)) { const n = await db.appointment.count({ where: { tenantId, startsAt: { gte: start, lt: end }, status: { notIn: ["CANCELLED", "NO_SHOW"] }, ...(own ? { doctorUserId: userId } : {}) } }); parts.push(`${n} appointment${n === 1 ? "" : "s"}`); }
  if (["DOCTOR", "RECEPTIONIST", "CLINIC_ADMIN"].includes(u.role.key)) { const n = await db.followUp.count({ where: { tenantId, status: { in: OPEN_FU }, dueDate: today, ...(own ? { doctorUserId: userId } : {}) } }); parts.push(`${n} follow-up${n === 1 ? "" : "s"} due`); }
  if (own) { const n = await db.labReport.count({ where: { tenantId, doctorUserId: userId, currentVersion: { gt: 0 }, order: { is: { status: { not: "DOCTOR_REVIEWED" } } } } }); parts.push(`${n} report${n === 1 ? "" : "s"} to review`); }
  return parts.length ? `Today: ${parts.join(", ")}.` : null;
}

/** Platform health for Super Admins (evaluated on the scheduler tick AND lazily when a Super Admin looks, rate-limited by the event key). */
export async function platformHealth(now = new Date()): Promise<number> {
  let n = 0;
  if (process.env.CRON_SECRET) { // the scheduler is only expected to run when it is configured
    const last = await db.notificationEvent.findFirst({ where: { userId: "system:scheduler" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const minutes = last ? Math.floor((now.getTime() - last.createdAt.getTime()) / 60_000) : null;
    if (last && minutes! >= 15) n += (await safeNotify({ tenantId: null, type: "SCHEDULER_STALE", eventKey: `sched-stale:${now.toISOString().slice(0, 13)}`, vars: { minutes: String(minutes) }, actionUrl: "/platform/communications" }))?.created ?? 0;
  }
  const backlog = await db.communicationMessage.count({ where: { status: { in: ["QUEUED", "RETRYING"] }, scheduledAt: { lte: new Date(now.getTime() - 15 * 60_000) } } });
  if (backlog >= 25) n += (await safeNotify({ tenantId: null, type: "QUEUE_BACKLOG", eventKey: `backlog:${now.toISOString().slice(0, 13)}`, vars: { count: String(backlog) }, actionUrl: "/platform/communications" }))?.created ?? 0;
  return n;
}

export async function runNotificationJobs(now = new Date()): Promise<JobSummary> {
  const sum: JobSummary = { tenants: 0, reminders: 0, digests: 0, stock: 0, escalated: 0, archived: 0, alerts: 0 };
  await db.notificationEvent.create({ data: { userId: "system:scheduler", eventKey: `run:${now.toISOString()}` } }).catch(() => undefined); // heartbeat
  await db.notificationEvent.deleteMany({ where: { userId: "system:scheduler", createdAt: { lt: new Date(now.getTime() - 2 * 86_400_000) } } });
  const tenants = await db.tenant.findMany({ where: { deletedAt: null, status: { in: ["ACTIVE", "TRIAL"] } }, select: { id: true, timezone: true } });
  for (const t of tenants) { try { await tenantJobs(t.id, t.timezone, now, sum); sum.tenants++; } catch (err) { logger.error("notification jobs failed for a clinic", { error: err }); } }
  try { sum.alerts += await platformHealth(now); } catch (err) { logger.error("platform health check failed", { error: err }); }
  return sum;
}
