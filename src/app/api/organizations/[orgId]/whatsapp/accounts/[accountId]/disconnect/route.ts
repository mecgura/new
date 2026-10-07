import { handle, ok } from "@/lib/api";
import { requireOrgAccess } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { disconnectAccount } from "@/services/whatsapp";

type Ctx = { params: Promise<{ orgId: string; accountId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const p = await params;
  const orgId = idSchema.parse(p.orgId);
  const access = await requireOrgAccess(orgId, "whatsapp:manage", req);
  return ok({ account: await disconnectAccount({ organizationId: orgId, actorUserId: access.user.id, req }, idSchema.parse(p.accountId)) });
});
