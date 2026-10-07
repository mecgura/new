import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireOrgAccess } from "@/lib/session";
import { embeddedStartSchema, idSchema } from "@/lib/validations";
import { startEmbeddedSignup } from "@/services/whatsapp";

type Ctx = { params: Promise<{ orgId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const orgId = idSchema.parse((await params).orgId);
  const access = await requireOrgAccess(orgId, "whatsapp:manage", req);
  enforceRateLimit(`wa-start:${access.user.id}`, 10, 15 * 60_000);
  const { method } = await readJson(req, embeddedStartSchema);
  return ok(await startEmbeddedSignup({ organizationId: orgId, actorUserId: access.user.id, req }, method));
});
