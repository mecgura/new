import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { paginationSchema } from "@/lib/validations";
import { listLogs } from "@/services/api/keys";

type Ctx = { params: Promise<{ orgId: string }> };
const query = paginationSchema.extend({
  keyId: z.string().max(64).optional().default(""),
  status: z.enum(["", "2xx", "4xx", "5xx", "429"]).optional().default(""),
  method: z.enum(["", "GET", "POST", "PATCH", "PUT", "DELETE"]).optional().default(""),
  q: z.string().trim().max(100).optional().default(""),
});

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "api:read");
  const q = readQuery(req, query);
  return ok({ ...(await listLogs(access.organizationId, { ...q, keyId: q.keyId || undefined, status: q.status || undefined, method: q.method || undefined, q: q.q || undefined })), page: q.page, pageSize: q.pageSize });
});
