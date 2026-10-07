import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { paginationSchema } from "@/lib/validations";
import { listInvoices } from "@/services/billing/billing";

type Ctx = { params: Promise<{ orgId: string }> };
const query = paginationSchema.extend({ status: z.enum(["", "open", "paid", "void"]).optional().default("") });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "billing:read");
  const q = readQuery(req, query);
  return ok({ ...(await listInvoices(access.organizationId, { ...q, status: q.status || undefined })), page: q.page, pageSize: q.pageSize });
});
