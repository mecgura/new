import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { requireSuperAdmin } from "@/lib/session";
import { paginationSchema } from "@/lib/validations";
import { adminListPayments } from "@/services/billing/admin";

const query = paginationSchema.extend({ status: z.enum(["", "created", "succeeded", "failed"]).optional().default("") });

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  const q = readQuery(req, query);
  return ok({ ...(await adminListPayments({ ...q, status: q.status || undefined })), page: q.page, pageSize: q.pageSize });
});
