import { db } from "@/lib/db";

/**
 * Admin → Security: sign-in attacks, permission denials, risky actions and admin sign-ins, from the audit log.
 * Read-only; every number is a count of real audit rows.
 */
const DAY = 86_400_000;
export const SENSITIVE_ACTIONS = [
  "member.role_changed", "member.removed", "user.deleted", "client.deleted", "client.access_reset", "auth.sessions_revoked", "auth.password_reset",
  "api_key.created", "api_key.revoked", "api_key.rotated", "contacts.bulk_deleted", "contacts.exported", "inbox.exported", "revenue.exported",
  "workspace.exported", "workspace.deletion_requested", "workspace.deletion_executed", "settings.changed", "ai.settings_updated", "billing.settings_updated", "whatsapp.deleted",
];
/** Failed sign-ins from one IP in 24 h that we flag as a likely password-guessing attempt. */
export const BRUTE_FORCE_THRESHOLD = 10;

export async function securityOverview(now = new Date()) {
  const d1 = new Date(now.getTime() - DAY);
  const d7 = new Date(now.getTime() - 7 * DAY);
  const d14 = new Date(now.getTime() - 14 * DAY);
  const d37 = new Date(now.getTime() - 37 * DAY);
  const [failed24, failed7, ok24, denied7, failedRows, deniedRows, sensitive, admins, pendingDeletion] = await Promise.all([
    db.auditLog.count({ where: { action: "auth.login_failed", createdAt: { gte: d1 } } }),
    db.auditLog.count({ where: { action: "auth.login_failed", createdAt: { gte: d7 } } }),
    db.auditLog.count({ where: { action: "auth.login", createdAt: { gte: d1 } } }),
    db.auditLog.count({ where: { action: "permission.denied", createdAt: { gte: d7 } } }),
    db.auditLog.findMany({ where: { action: "auth.login_failed", createdAt: { gte: d14 } }, select: { ip: true, actorUserId: true, metadata: true, createdAt: true }, take: 5000, orderBy: { createdAt: "desc" } }),
    db.auditLog.findMany({ where: { action: "permission.denied", createdAt: { gte: d7 } }, select: { actorUserId: true, targetType: true, createdAt: true, actor: { select: { email: true } } }, take: 2000 }),
    db.auditLog.findMany({ where: { action: { in: SENSITIVE_ACTIONS }, createdAt: { gte: d7 } }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, action: true, createdAt: true, ip: true, targetType: true, targetId: true, actor: { select: { email: true } }, organization: { select: { name: true } } } }),
    db.user.findMany({ where: { role: "SUPER_ADMIN" }, select: { id: true, email: true } }),
    db.dataRequest.count({ where: { status: "pending" } }),
  ]);

  // Failed sign-ins per day (14 days) and per IP / account.
  const series = Array.from({ length: 14 }, (_, i) => {
    const from = new Date(now.getTime() - (13 - i) * DAY);
    const key = from.toISOString().slice(0, 10);
    return { day: key, failed: 0 };
  });
  const byIp = new Map<string, { ip: string; failed24h: number; failed14d: number; lastAt: Date; accounts: Set<string> }>();
  const byAccount = new Map<string, { userId: string; failed7d: number; reasons: Set<string>; lastAt: Date }>();
  for (const r of failedRows) {
    const day = series.find((s) => s.day === r.createdAt.toISOString().slice(0, 10));
    if (day) day.failed++;
    const ip = r.ip || "unknown";
    const e = byIp.get(ip) ?? { ip, failed24h: 0, failed14d: 0, lastAt: r.createdAt, accounts: new Set<string>() };
    e.failed14d++;
    if (r.createdAt >= d1) e.failed24h++;
    if (r.createdAt > e.lastAt) e.lastAt = r.createdAt;
    if (r.actorUserId) e.accounts.add(r.actorUserId);
    byIp.set(ip, e);
    if (r.actorUserId && r.createdAt >= d7) {
      const a = byAccount.get(r.actorUserId) ?? { userId: r.actorUserId, failed7d: 0, reasons: new Set<string>(), lastAt: r.createdAt };
      a.failed7d++;
      try {
        a.reasons.add(String((JSON.parse(r.metadata) as { reason?: string }).reason ?? ""));
      } catch {
        /* ignore */
      }
      byAccount.set(r.actorUserId, a);
    }
  }
  const accountIds = [...byAccount.keys()];
  const emails = new Map((await db.user.findMany({ where: { id: { in: accountIds } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));

  // Super Admin sign-ins in 7 days; an IP not used by that admin in the 30 days before is marked new.
  const adminIds = admins.map((a) => a.id);
  const adminLogins = await db.auditLog.findMany({ where: { action: "auth.login", actorUserId: { in: adminIds }, createdAt: { gte: d37 } }, orderBy: { createdAt: "desc" }, select: { actorUserId: true, ip: true, userAgent: true, createdAt: true }, take: 1000 });
  const recentAdmin = adminLogins.filter((l) => l.createdAt >= d7).slice(0, 30).map((l) => ({
    email: admins.find((a) => a.id === l.actorUserId)?.email ?? "",
    ip: l.ip,
    userAgent: l.userAgent.slice(0, 120),
    at: l.createdAt,
    newIp: Boolean(l.ip) && !adminLogins.some((o) => o.actorUserId === l.actorUserId && o.ip === l.ip && o.createdAt < new Date(l.createdAt.getTime() - 60_000) && o.createdAt >= new Date(l.createdAt.getTime() - 30 * DAY)),
  }));

  const suspiciousIps = [...byIp.values()].filter((e) => e.failed24h >= BRUTE_FORCE_THRESHOLD);
  const deniedByUser = new Map<string, { email: string; count: number }>();
  for (const d of deniedRows) {
    const k = d.actorUserId ?? "unknown";
    const e = deniedByUser.get(k) ?? { email: d.actor?.email ?? "unknown", count: 0 };
    e.count++;
    deniedByUser.set(k, e);
  }
  return {
    checkedAt: now,
    totals: { failedLogins24h: failed24, failedLogins7d: failed7, logins24h: ok24, permissionDenied7d: denied7, suspiciousIps: suspiciousIps.length, newAdminIps: recentAdmin.filter((l) => l.newIp).length, pendingDeletionRequests: pendingDeletion },
    failedSeries: series,
    topIps: [...byIp.values()].sort((a, b) => b.failed24h - a.failed24h || b.failed14d - a.failed14d).slice(0, 10).map((e) => ({ ip: e.ip, failed24h: e.failed24h, failed14d: e.failed14d, accounts: e.accounts.size, lastAt: e.lastAt, flagged: e.failed24h >= BRUTE_FORCE_THRESHOLD })),
    topAccounts: [...byAccount.values()].sort((a, b) => b.failed7d - a.failed7d).slice(0, 10).map((a) => ({ email: emails.get(a.userId) ?? "deleted user", failed7d: a.failed7d, reasons: [...a.reasons].filter(Boolean), lastAt: a.lastAt })),
    permissionDenied: [...deniedByUser.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    sensitive: sensitive.map((s) => ({ id: s.id, action: s.action, at: s.createdAt, ip: s.ip, actor: s.actor?.email ?? "system", organization: s.organization?.name ?? "", target: `${s.targetType}${s.targetId ? ` ${s.targetId.slice(0, 12)}` : ""}` })),
    adminLogins: recentAdmin,
  };
}
