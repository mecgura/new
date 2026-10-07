import { handle, ok, readQuery } from "@/lib/api";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { auditQuerySchema } from "@/lib/validations";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const q = readQuery(req, auditQuerySchema);
  const where = q.action ? { action: q.action } : {};
  const [items, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        ip: true,
        createdAt: true,
        actor: { select: { name: true, email: true } },
        organization: { select: { id: true, name: true } },
      },
    }),
    db.auditLog.count({ where }),
  ]);
  return ok({ items, total, page: q.page, pageSize: q.pageSize });
});
