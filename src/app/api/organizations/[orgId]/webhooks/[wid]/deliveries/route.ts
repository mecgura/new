import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { paginationSchema } from "@/lib/validations";
import { listDeliveries } from "@/services/webhooks/endpoints";

type Ctx = { params: Promise<{ orgId: string; wid: string }> };
const query = paginationSchema.extend({ status: z.enum(["", "pending", "delivered", "failed"]).optional().default("") });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "webhooks:read");
  const q = readQuery(req, query);
  return ok({ ...(await listDeliveries(access.organizationId, ids.wid, { ...q, status: q.status || undefined })), page: q.page, pageSize: q.pageSize });
});
