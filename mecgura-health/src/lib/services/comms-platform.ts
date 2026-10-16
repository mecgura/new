import "server-only";
import type { RequestContext } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { CHANNELS } from "@/lib/communications/catalog";
import { providerStatus } from "@/lib/communications/providers/registry";

/** Super Admin only: platform-wide delivery health. Aggregates only — no recipients, no message text, no patient data, and never provider credentials. */
export async function platformCommOverview(ctx: RequestContext, days = 7) {
  if (ctx.user.role !== "SUPER_ADMIN" || !ctx.permissions.has("platform.manage")) throw new AppError("FORBIDDEN");
  const since = new Date(Date.now() - Math.min(90, Math.max(1, days)) * 86_400_000); const where = { createdAt: { gte: since } };
  const [byStatus, byChannel, byTenant, failures, queue] = await Promise.all([
    db.communicationMessage.groupBy({ by: ["status"], where, _count: { _all: true } }),
    db.communicationMessage.groupBy({ by: ["channel", "status"], where, _count: { _all: true } }),
    db.communicationMessage.groupBy({ by: ["tenantId", "status"], where, _count: { _all: true } }),
    db.communicationMessage.groupBy({ by: ["failureCode"], where: { ...where, status: "FAILED" }, _count: { _all: true }, orderBy: { _count: { failureCode: "desc" } }, take: 8 }),
    db.communicationMessage.count({ where: { status: { in: ["QUEUED", "RETRYING"] }, scheduledAt: { lte: new Date() } } }),
  ]);
  const tenants = await db.tenant.findMany({ where: { id: { in: [...new Set(byTenant.map((r) => r.tenantId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
  const perTenant = new Map<string, { tenantId: string; clinic: string; total: number; failed: number; delivered: number }>();
  for (const r of byTenant) { const x = perTenant.get(r.tenantId) ?? { tenantId: r.tenantId, clinic: nameOf.get(r.tenantId) ?? "—", total: 0, failed: 0, delivered: 0 }; if (r.status !== "SKIPPED") x.total += r._count._all; if (r.status === "FAILED") x.failed += r._count._all; if (r.status === "DELIVERED" || r.status === "READ") x.delivered += r._count._all; perTenant.set(r.tenantId, x); }
  const n = (st: string[]) => byStatus.filter((x) => st.includes(x.status)).reduce((a, x) => a + x._count._all, 0);
  return {
    days, providers: CHANNELS.map((c) => { const p = providerStatus(c); return { channel: c, provider: p.provider, configured: p.configured, webhookReady: p.webhookReady, hint: p.hint }; }),
    totals: { total: n(["QUEUED", "PROCESSING", "RETRYING", "SENT", "DELIVERED", "READ", "FAILED", "CANCELLED"]), sent: n(["SENT", "DELIVERED", "READ"]), delivered: n(["DELIVERED", "READ"]), failed: n(["FAILED"]), pending: n(["QUEUED", "PROCESSING", "RETRYING"]), skipped: n(["SKIPPED"]), dueNow: queue },
    channels: CHANNELS.map((c) => ({ channel: c, count: byChannel.filter((x) => x.channel === c && x.status !== "SKIPPED").reduce((a, x) => a + x._count._all, 0), failed: byChannel.filter((x) => x.channel === c && x.status === "FAILED").reduce((a, x) => a + x._count._all, 0) })),
    clinics: [...perTenant.values()].sort((a, b) => b.total - a.total).slice(0, 25), failureCodes: failures.map((f) => ({ code: f.failureCode ?? "UNKNOWN", count: f._count._all })),
    scheduler: { configured: !!process.env.CRON_SECRET, inlineWorker: process.env.COMMUNICATIONS_INLINE_WORKER !== "false" },
  };
}
