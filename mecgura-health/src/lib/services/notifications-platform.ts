import "server-only";
import type { RequestContext } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { CATEGORY_LABEL, PRIORITIES, PRIORITY_RANK, categoryOfType } from "@/lib/notifications/catalog";
import { platformHealth } from "@/lib/notifications/jobs";

const PAGE = 20;
/** Super Admin only. Platform health from system / security alerts and delivery failures; never patient content (those categories are excluded). */
export async function platformNotificationOverview(ctx: RequestContext, q: { tenantId?: string; category?: string; priority?: string; status?: string; from?: string; to?: string; page?: number } = {}) {
  if (ctx.user.role !== "SUPER_ADMIN" || !ctx.permissions.has("platform.manage")) throw new AppError("FORBIDDEN");
  await platformHealth().catch(() => 0);
  const now = new Date(); const d7 = new Date(now.getTime() - 7 * 86_400_000); const d30 = new Date(now.getTime() - 30 * 86_400_000); const page = Math.max(1, q.page ?? 1);
  const categories = q.category === "SECURITY" || q.category === "SYSTEM" ? [q.category] : ["SYSTEM", "SECURITY"];
  const range = { ...(q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? { gte: new Date(`${q.from}T00:00:00Z`) } : { gte: d30 }), ...(q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? { lt: new Date(Date.parse(`${q.to}T00:00:00Z`) + 86_400_000) } : {}) };
  const minRank = PRIORITY_RANK.HIGH; const prios = (PRIORITIES as readonly string[]).filter((p) => PRIORITY_RANK[p] >= minRank);
  const where = { category: { in: categories }, priority: { in: q.priority && prios.includes(q.priority) ? [q.priority] : prios }, createdAt: range, ...(q.tenantId ? { tenantId: q.tenantId } : {}), ...(q.status === "unread" ? { readAt: null } : q.status === "read" ? { readAt: { not: null } } : {}) };
  const [rows, byPriority, failedJobs, providerFailures, byTenant, tenants] = await Promise.all([
    db.notification.findMany({ where, distinct: ["tenantId", "type", "sourceEventId"], orderBy: { createdAt: "desc" }, take: 300 }),
    db.notification.groupBy({ by: ["priority"], where: { createdAt: { gte: d30 } }, _count: { _all: true } }),
    db.communicationMessage.count({ where: { status: "FAILED", failedAt: { gte: d7 } } }),
    db.notification.count({ where: { type: "PROVIDER_FAILURE", createdAt: { gte: d7 } } }),
    db.communicationMessage.groupBy({ by: ["tenantId"], where: { status: "FAILED", failedAt: { gte: d7 } }, _count: { _all: true }, orderBy: { _count: { tenantId: "desc" } }, take: 8 }),
    db.tenant.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 }),
  ]);
  const name = new Map(tenants.map((t) => [t.id, t.name]));
  const critical = await db.notification.count({ where: { priority: "CRITICAL", readAt: null, userId: ctx.user.id } });
  const open = rows.slice((page - 1) * PAGE, page * PAGE);
  return {
    totals: { total30d: byPriority.reduce((a, x) => a + x._count._all, 0), byPriority: PRIORITIES.map((p) => ({ priority: p, count: byPriority.find((x) => x.priority === p)?._count._all ?? 0 })), criticalOpen: critical, failedJobs7d: failedJobs, providerFailures7d: providerFailures },
    tenantIssues: byTenant.map((t) => ({ tenantId: t.tenantId, clinic: name.get(t.tenantId) ?? "—", failed: t._count._all })),
    alerts: open.map((n) => ({ id: n.id, clinic: n.tenantId ? name.get(n.tenantId) ?? "—" : "Platform", tenantId: n.tenantId, category: categoryOfType(n.type, n.category), categoryLabel: CATEGORY_LABEL[categoryOfType(n.type, n.category)], priority: n.priority, title: n.title, body: n.body, createdAt: n.createdAt.toISOString(), read: !!n.readAt })),
    total: rows.length, page, pageSize: PAGE, tenants: tenants.map((t) => ({ id: t.id, name: t.name })),
  };
}
