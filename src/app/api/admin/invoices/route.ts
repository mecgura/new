import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { paginationSchema } from "@/lib/validations";
import { adminListInvoices } from "@/services/billing/admin";

const query = paginationSchema.extend({ status: z.enum(["", "open", "paid", "void", "overdue"]).optional().default(""), q: z.string().trim().max(100).optional().default(""), organizationId: z.string().max(64).optional().default("") });

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const q = readQuery(req, query);
  return ok({ ...(await adminListInvoices({ ...q, status: q.status || undefined, q: q.q || undefined, organizationId: q.organizationId || undefined })), page: q.page, pageSize: q.pageSize });
});
