import "server-only";
import { db } from "@/lib/db";
import type { RequestContext } from "@/lib/auth/context";
import { CHANNELS } from "@/lib/communications/catalog";
import { providerStatus } from "@/lib/communications/providers/registry";
import { zonedToUtc, todayIn, addDays } from "@/lib/scheduling/time";
import { chunkArr, guard } from "./platform-monitor-util";
import { platformCommOverview } from "./comms-platform";

/**
 * Super Admin monitoring. Everything here is a count / timestamp / configuration flag read from the real tables.
 * Where nothing is recorded (error store, backups, provider health probes) the answer is "unavailable", never a made-up number.
 */
export async function platformDashboard(ctx: RequestContext) {
  guard(ctx);
  const now = Date.now(); const d1 = new Date(now - 86_400_000); const d7 = new Date(now - 7 * 86_400_000);
  const base = { deletedAt: null } as const;
  const [byStatus, userRoles, userStatus, locked, patients, active, recent, loginsDay, admin, critical, roles] = await Promise.all([
    db.tenant.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    db.user.groupBy({ by: ["roleId"], where: { ...base, tenantId: { not: null } }, _count: { _all: true } }),
    db.user.groupBy({ by: ["status"], where: { ...base, tenantId: { not: null } }, _count: { _all: true } }),
    db.user.count({ where: { ...base, lockedUntil: { gt: new Date() } } }),
    db.patient.count({ where: base }),
    db.tenant.findMany({ where: { ...base, status: { in: ["ACTIVE", "TRIAL"] } }, select: { id: true, timezone: true } }),
    db.tenant.findMany({ where: base, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, name: true, status: true, clinicType: true, createdAt: true } }),
    db.auditLog.count({ where: { action: "auth.login_succeeded", createdAt: { gte: d1 } } }),
    db.auditLog.findMany({ where: { OR: [{ action: { startsWith: "platform." } }, { action: { startsWith: "clinic." } }, { action: { startsWith: "tenant." } }, { action: { startsWith: "domain." } }] }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, action: true, tenantId: true, actorId: true, createdAt: true } }),
    db.notification.count({ where: { userId: ctx.user.id, priority: { in: ["CRITICAL", "URGENT"] }, readAt: null, archivedAt: null } }),
    db.role.findMany({ where: { tenantId: null }, select: { id: true, key: true } }),
  ]);
  const roleKey = new Map(roles.map((r) => [r.id, r.key]));
  const usersByRole: Record<string, number> = {}; for (const u of userRoles) { const k = roleKey.get(u.roleId) ?? "?"; usersByRole[k] = (usersByRole[k] ?? 0) + u._count._all; }
  const staffUsers = Object.entries(usersByRole).filter(([k]) => k !== "PATIENT").reduce((a, [, n]) => a + n, 0);
  // "today" is each clinic's own today: group clinics by timezone, one count per timezone
  let todayAppts = 0; const byTz = new Map<string, string[]>(); for (const t of active) byTz.set(t.timezone, [...(byTz.get(t.timezone) ?? []), t.id]);
  for (const [tz, ids] of byTz) { const day = todayIn(tz); const s = zonedToUtc(day, 0, tz); const e = zonedToUtc(addDays(day, 1), 0, tz); for (const part of chunkArr(ids, 400)) todayAppts += await db.appointment.count({ where: { tenantId: { in: part }, startsAt: { gte: s, lt: e } } }); }
  const n = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
  const providers = CHANNELS.map((c) => providerStatus(c));
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set(admin.map((a) => a.actorId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const tnames = new Map((await db.tenant.findMany({ where: { id: { in: [...new Set(admin.map((a) => a.tenantId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  const comm = await platformCommOverview(ctx, 7);
  const sys = await systemHealth(ctx);
  return {
    kpis: { clinics: byStatus.reduce((a, s) => a + s._count._all, 0), active: n("ACTIVE") + n("TRIAL"), suspended: n("SUSPENDED"), pending: n("PENDING"), inactive: n("INACTIVE"), archived: n("ARCHIVED"), users: staffUsers, doctors: usersByRole.DOCTOR ?? 0, patients, todayAppointments: todayAppts, activeProviders: providers.filter((p) => p.configured).length, providersTotal: providers.length, criticalAlerts: critical },
    tenants: { byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })), recent },
    users: { byRole: Object.entries(usersByRole).filter(([k]) => k !== "PATIENT").map(([role, count]) => ({ role, count })), byStatus: userStatus.map((s) => ({ status: s.status, count: s._count._all })), locked, patientPortalAccounts: usersByRole.PATIENT ?? 0 },
    activity: { loginsLast24h: loginsDay, appointmentsToday: todayAppts },
    communication: { providers: comm.providers, totals: comm.totals, scheduler: comm.scheduler },
    recentAdminActivity: admin.map((a) => ({ id: a.id, action: a.action, at: a.createdAt, actor: a.actorId ? names.get(a.actorId) ?? "—" : "System", clinic: a.tenantId ? tnames.get(a.tenantId) ?? "—" : "Platform" })),
    health: sys.overall, alerts: [...sys.alerts], generatedAt: new Date().toISOString(), since7d: d7.toISOString(),
  };
}

export async function systemHealth(ctx: RequestContext) {
  guard(ctx);
  const t0 = Date.now(); let dbOk = true; let dbMs: number | null = null;
  try { await db.$queryRaw`SELECT 1`; dbMs = Date.now() - t0; } catch { dbOk = false; }
  const d1 = new Date(Date.now() - 86_400_000); const now = new Date();
  const [queued, retrying, failed24, oldest, hb, lastWebhook, webhookBad, assets, lastAttempt] = dbOk ? await Promise.all([
    db.communicationMessage.count({ where: { status: { in: ["QUEUED", "PROCESSING"] }, scheduledAt: { lte: now } } }), db.communicationMessage.count({ where: { status: "RETRYING" } }),
    db.communicationMessage.count({ where: { status: "FAILED", failedAt: { gte: d1 } } }),
    db.communicationMessage.findFirst({ where: { status: { in: ["QUEUED", "RETRYING"] }, scheduledAt: { lte: now } }, orderBy: { scheduledAt: "asc" }, select: { scheduledAt: true } }),
    db.platformSetting.findUnique({ where: { key: "scheduler.heartbeat" } }),
    db.communicationWebhookEvent.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true, provider: true, outcome: true } }),
    db.communicationWebhookEvent.count({ where: { receivedAt: { gte: d1 }, outcome: "unknown_message" } }),
    db.tenantAsset.aggregate({ _sum: { size: true }, _count: { _all: true } }),
    db.communicationAttempt.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]) : [0, 0, 0, null, null, null, 0, { _sum: { size: null }, _count: { _all: 0 } }, null] as never[];
  let heartbeat: Date | null = null; try { heartbeat = hb ? new Date(JSON.parse((hb as { value: string }).value).at) : null; } catch { /* unreadable heartbeat */ }
  const oldestAgeMin = oldest ? Math.round((Date.now() - (oldest as { scheduledAt: Date }).scheduledAt.getTime()) / 60000) : null;
  const schedulerConfigured = !!process.env.CRON_SECRET && process.env.CRON_SECRET.length >= 16;
  const stale = schedulerConfigured && (!heartbeat || Date.now() - heartbeat.getTime() > 15 * 60_000);
  const components = [
    { key: "application", label: "Application", status: "ok" as const, detail: `Running (Node ${process.version}, ${process.env.NODE_ENV ?? "unknown"} mode, up ${Math.round(process.uptime() / 60)} min)` },
    { key: "database", label: "Database", status: dbOk ? ("ok" as const) : ("down" as const), detail: dbOk ? `Responding in ${dbMs} ms` : "The database did not respond." },
    { key: "queue", label: "Message queue", status: !dbOk ? ("unknown" as const) : (oldestAgeMin ?? 0) > 30 ? ("warn" as const) : ("ok" as const), detail: `${queued} due, ${retrying} retrying, ${failed24} failed in 24 h${oldestAgeMin !== null ? `; oldest waiting ${oldestAgeMin} min` : ""}` },
    { key: "scheduler", label: "Scheduler", status: !schedulerConfigured ? ("unknown" as const) : stale ? ("warn" as const) : ("ok" as const), detail: !schedulerConfigured ? "Not configured (CRON_SECRET is not set), so reminders and delivery retries do not run on a schedule." : heartbeat ? `Last tick ${heartbeat.toISOString()}` : "No tick has been recorded yet." },
    { key: "webhooks", label: "Provider webhooks", status: !dbOk ? ("unknown" as const) : (webhookBad as number) > 0 ? ("warn" as const) : ("ok" as const), detail: lastWebhook ? `Last event ${(lastWebhook as { receivedAt: Date }).receivedAt.toISOString()} (${(lastWebhook as { provider: string }).provider}); ${webhookBad} for unknown messages in 24 h` : "No webhook has been received yet." },
    { key: "storage", label: "Storage", status: "ok" as const, detail: `${(assets as { _count: { _all: number } })._count._all} stored branding file(s), ${Math.round((((assets as { _sum: { size: number | null } })._sum.size ?? 0) / 1024))} KB. Disk and object-storage capacity are not monitored here.` },
    { key: "errors", label: "Error monitoring", status: "unknown" as const, detail: "Not connected. Errors are written to the server log only; no error store exists to summarise." },
    { key: "backups", label: "Backups", status: "unknown" as const, detail: "Backup status is not available. Backup and recovery are handled in a later phase." },
  ];
  const alerts = components.filter((c) => c.status === "warn" || c.status === "down").map((c) => `${c.label}: ${c.detail}`);
  return { overall: components.some((c) => c.status === "down") ? "down" : components.some((c) => c.status === "warn") ? "degraded" : "ok", components, alerts, lastDeliveryActivity: (lastAttempt as { createdAt: Date } | null)?.createdAt ?? null, generatedAt: new Date().toISOString() };
}

/** Provider status, last success / failure, failure counts and webhook state. Credentials are never read into the response. */
export async function providerMonitor(ctx: RequestContext) {
  guard(ctx); const d7 = new Date(Date.now() - 7 * 86_400_000); const d1 = new Date(Date.now() - 86_400_000);
  return Promise.all(CHANNELS.map(async (c) => {
    const p = providerStatus(c);
    const [ok, bad, f7, f1, sent7, hook] = await Promise.all([
      db.communicationMessage.findFirst({ where: { channel: c, sentAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
      db.communicationMessage.findFirst({ where: { channel: c, status: "FAILED" }, orderBy: { failedAt: "desc" }, select: { failedAt: true, failureCode: true } }),
      db.communicationMessage.count({ where: { channel: c, status: "FAILED", failedAt: { gte: d7 } } }), db.communicationMessage.count({ where: { channel: c, status: "FAILED", failedAt: { gte: d1 } } }),
      db.communicationMessage.count({ where: { channel: c, sentAt: { gte: d7 } } }),
      p.provider ? db.communicationWebhookEvent.findFirst({ where: { provider: p.provider }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }) : null,
    ]);
    const state = !p.provider ? "NOT_CONFIGURED" : !p.supported ? "ERROR" : p.configured ? "CONFIGURED" : "ERROR";
    return { channel: c, provider: p.provider, state, configured: p.configured, webhookReady: p.webhookReady, hint: p.hint, lastSuccessAt: ok?.sentAt ?? null, lastFailureAt: bad?.failedAt ?? null, lastFailureCode: bad?.failureCode ?? null, failures7d: f7, failures24h: f1, sent7d: sent7, lastWebhookAt: hook?.receivedAt ?? null,
      health: sent7 + f7 === 0 ? "Health status unavailable (no traffic in the last 7 days)" : `${Math.round((sent7 * 100) / (sent7 + f7))}% of attempts succeeded in the last 7 days` };
  }));
}

export async function webhookMonitor(ctx: RequestContext) {
  guard(ctx); const d1 = new Date(Date.now() - 86_400_000);
  const rows = await db.communicationWebhookEvent.groupBy({ by: ["provider", "outcome"], where: { receivedAt: { gte: d1 } }, _count: { _all: true }, _max: { receivedAt: true } });
  const providers = [...new Set(rows.map((r) => r.provider))];
  return { endpoints: CHANNELS.map((c) => { const p = providerStatus(c); const mine = rows.filter((r) => r.provider === p.provider); return { channel: c, provider: p.provider, verificationReady: p.webhookReady, events24h: mine.reduce((a, r) => a + r._count._all, 0), problems24h: mine.filter((r) => r.outcome === "unknown_message").reduce((a, r) => a + r._count._all, 0), lastEventAt: mine.reduce<Date | null>((a, r) => (r._max.receivedAt && (!a || r._max.receivedAt > a) ? r._max.receivedAt : a), null) }; }), providersSeen: providers, note: "Signing secrets are never shown." };
}

export async function notificationMonitor(ctx: RequestContext) {
  guard(ctx); const d1 = new Date(Date.now() - 86_400_000); const now = new Date();
  const [byStatus, byChannel, notif] = await Promise.all([
    db.communicationMessage.groupBy({ by: ["status"], where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: { _all: true } }),
    db.communicationMessage.groupBy({ by: ["channel", "status"], where: { status: { in: ["QUEUED", "RETRYING", "FAILED", "PROCESSING"] }, createdAt: { gte: d1 } }, _count: { _all: true } }),
    db.notification.groupBy({ by: ["priority"], where: { createdAt: { gte: d1 } }, _count: { _all: true } }),
  ]);
  const c = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
  const due = await db.communicationMessage.count({ where: { status: { in: ["QUEUED", "RETRYING"] }, scheduledAt: { lte: now } } });
  return { queued: c("QUEUED"), processing: c("PROCESSING"), retrying: c("RETRYING"), failed7d: c("FAILED"), dueNow: due, byChannel: byChannel.map((x) => ({ channel: x.channel, status: x.status, count: x._count._all })), inApp24h: notif.map((x) => ({ priority: x.priority, count: x._count._all })), webhooks: await webhookMonitor(ctx) };
}

/** Platform usage aggregates (counts per clinic, top clinics). Per-clinic analytics themselves live in Phase 13 (/analytics inside a clinic). */
export async function platformUsage(ctx: RequestContext) {
  guard(ctx); const d30 = new Date(Date.now() - 30 * 86_400_000);
  const [appts, msgs, logins] = await Promise.all([
    db.appointment.groupBy({ by: ["tenantId"], where: { startsAt: { gte: d30 } }, _count: { _all: true }, orderBy: { _count: { tenantId: "desc" } }, take: 10 }),
    db.communicationMessage.groupBy({ by: ["tenantId"], where: { createdAt: { gte: d30 } }, _count: { _all: true }, orderBy: { _count: { tenantId: "desc" } }, take: 10 }),
    db.user.groupBy({ by: ["tenantId"], where: { lastLoginAt: { gte: d30 }, tenantId: { not: null } }, _count: { _all: true }, orderBy: { _count: { tenantId: "desc" } }, take: 10 }),
  ]);
  const ids = [...new Set([...appts, ...msgs, ...logins].map((r) => r.tenantId).filter((x): x is string => !!x))];
  const names = new Map((await db.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  const shape = (rows: { tenantId: string | null; _count: { _all: number } }[]) => rows.map((r) => ({ clinicId: r.tenantId, clinic: r.tenantId ? names.get(r.tenantId) ?? "—" : "—", count: r._count._all }));
  const [totalAppts, totalConsults, totalInvoices] = await Promise.all([db.appointment.count({ where: { startsAt: { gte: d30 } } }), db.consultation.count({ where: { startedAt: { gte: d30 } } }), db.invoice.count({ where: { createdAt: { gte: d30 } } })]);
  return { windowDays: 30, totals: { appointments: totalAppts, consultations: totalConsults, invoices: totalInvoices }, topByAppointments: shape(appts), topByMessages: shape(msgs), topByActiveUsers: shape(logins) };
}
