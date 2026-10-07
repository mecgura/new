import { handle, ok, readQuery } from "@/lib/api";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { listQuerySchema } from "@/lib/validations";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const q = readQuery(req, listQuerySchema);
  const where = q.q ? { OR: [{ name: { contains: q.q } }, { email: { contains: q.q } }] } : {};
  const [items, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      // Never select passwordHash.
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        memberships: { select: { role: true, organization: { select: { id: true, name: true } } } },
      },
    }),
    db.user.count({ where }),
  ]);
  return ok({ items, total, page: q.page, pageSize: q.pageSize });
});
