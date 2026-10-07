import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/session";
import { listQuerySchema } from "@/lib/validations";

const querySchema = listQuerySchema.extend({ status: z.enum(["", "pending", "connected", "disconnected", "disabled"]).optional().default("") });

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const q = readQuery(req, querySchema);
  const where = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.q ? { OR: [{ phoneNumber: { contains: q.q } }, { displayName: { contains: q.q } }, { organization: { name: { contains: q.q } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    db.whatsAppAccount.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { organization: { select: { id: true, name: true, status: true } } },
    }),
    db.whatsAppAccount.count({ where }),
  ]);
  return ok({ items, total, page: q.page, pageSize: q.pageSize });
});
