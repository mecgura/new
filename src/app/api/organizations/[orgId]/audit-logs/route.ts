import { handle, ok, readQuery } from "@/lib/api";
import { requireOrgAccess } from "@/lib/session";
import { auditQuerySchema, idSchema } from "@/lib/validations";
import { listOrgAuditLogs } from "@/lib/services/organizations";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const orgId = idSchema.parse((await params).orgId);
  await requireOrgAccess(orgId, "audit:read", req);
  const q = readQuery(req, auditQuerySchema);
  const data = await listOrgAuditLogs(orgId, q);
  return ok({ ...data, page: q.page, pageSize: q.pageSize });
});
