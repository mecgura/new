import { handle, ok, readJson } from "@/lib/api";
import { requireOrgAccess } from "@/lib/session";
import { embeddedCancelSchema, idSchema } from "@/lib/validations";
import { cancelEmbeddedSignup } from "@/services/whatsapp";

type Ctx = { params: Promise<{ orgId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const orgId = idSchema.parse((await params).orgId);
  const access = await requireOrgAccess(orgId, "whatsapp:manage", req);
  const { state, reason } = await readJson(req, embeddedCancelSchema);
  await cancelEmbeddedSignup({ organizationId: orgId, actorUserId: access.user.id, req }, state, reason);
  return ok({ ok: true });
});
