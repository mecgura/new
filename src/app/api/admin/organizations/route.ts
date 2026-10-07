import { ACTIVE_NUMBER_STATUSES } from "@/lib/catalog";
import { handle, ok, readJson, readQuery } from "@/lib/api";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { clientListQuerySchema, createClientSchema } from "@/lib/validations";
import { createClient } from "@/lib/services/clients";
import { monthPrefix } from "@/lib/services/usage";

/** Client (tenant) list for the Super Admin table. */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const q = readQuery(req, clientListQuerySchema);
  const where = {
    ...(q.q ? { OR: [{ name: { contains: q.q } }, { slug: { contains: q.q } }, { contactEmail: { contains: q.q } }] } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.planId ? { subscriptions: { some: { status: "active", planId: q.planId } } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.organization.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        contactEmail: true,
        contactPhone: true,
        createdAt: true,
        _count: { select: { members: true, whatsappAccounts: { where: { status: { in: ACTIVE_NUMBER_STATUSES } } } } },
        members: { where: { role: "CLIENT_OWNER" }, orderBy: { createdAt: "asc" }, take: 1, select: { user: { select: { id: true, name: true, email: true } } } },
        subscriptions: { where: { status: "active" }, take: 1, select: { plan: { select: { id: true, name: true, slug: true, maxUsers: true, maxMonthlyMessages: true } } } },
      },
    }),
    db.organization.count({ where }),
  ]);
  const messages = await db.usageCounter.groupBy({
    by: ["organizationId"],
    where: { organizationId: { in: rows.map((r) => r.id) }, metric: "messages_sent", day: { startsWith: monthPrefix() } },
    _sum: { value: true },
  });
  const msgBy = new Map(messages.map((m) => [m.organizationId, m._sum.value ?? 0]));
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    contactEmail: r.contactEmail,
    contactPhone: r.contactPhone,
    createdAt: r.createdAt,
    owner: r.members[0]?.user ?? null,
    plan: r.subscriptions[0]?.plan ?? null,
    whatsappNumbers: r._count.whatsappAccounts,
    seats: r._count.members,
    messagesThisMonth: msgBy.get(r.id) ?? 0,
  }));
  return ok({ items, total, page: q.page, pageSize: q.pageSize });
});

export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const input = await readJson(req, createClientSchema);
  const { organization, createdUser } = await createClient(admin.id, input, req);
  return ok({ organization, createdOwnerAccount: createdUser }, { status: 201 });
});
