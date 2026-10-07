import { ACTIVE_NUMBER_STATUSES } from "@/lib/catalog";
import { handle, ok, readQuery } from "@/lib/api";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { listQuerySchema } from "@/lib/validations";
import { monthPrefix } from "@/lib/services/usage";

/** Per-client usage vs plan limits for the current month. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const q = readQuery(req, listQuerySchema);
  const where = q.q ? { name: { contains: q.q } } : {};
  const [orgs, total] = await Promise.all([
    db.organization.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        name: true,
        status: true,
        _count: { select: { members: true, whatsappAccounts: { where: { status: { in: ACTIVE_NUMBER_STATUSES } } } } },
        subscriptions: { where: { status: "active" }, take: 1, select: { plan: true } },
      },
    }),
    db.organization.count({ where }),
  ]);
  const counters = await db.usageCounter.groupBy({
    by: ["organizationId", "metric"],
    where: { organizationId: { in: orgs.map((o) => o.id) }, day: { startsWith: monthPrefix() } },
    _sum: { value: true },
  });
  const sum = (orgId: string, metric: string) => counters.find((c) => c.organizationId === orgId && c.metric === metric)?._sum.value ?? 0;
  const items = orgs.map((o) => {
    const plan = o.subscriptions[0]?.plan ?? null;
    return {
      id: o.id,
      name: o.name,
      status: o.status,
      plan: plan ? { id: plan.id, name: plan.name } : null,
      seats: { used: o._count.members, limit: plan?.maxUsers ?? null },
      whatsappNumbers: { used: o._count.whatsappAccounts, limit: plan?.maxWhatsAppNumbers ?? null },
      messages: { used: sum(o.id, "messages_sent"), limit: plan?.maxMonthlyMessages ?? null },
      contacts: { used: sum(o.id, "contacts_created"), limit: plan?.maxContacts ?? null },
      aiReplies: sum(o.id, "ai_replies"),
      apiCalls: sum(o.id, "api_calls"),
    };
  });
  return ok({ items, total, page: q.page, pageSize: q.pageSize, period: monthPrefix() });
});
