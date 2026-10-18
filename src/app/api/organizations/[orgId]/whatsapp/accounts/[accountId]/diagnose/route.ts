import { handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireOrgAccess } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { diagnoseConnection } from "@/services/whatsapp";

type Ctx = { params: Promise<{ orgId: string; accountId: string }> };

/** Owners/managers: asks Meta how this number is set up. Returns plain-language checks, never credentials. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const p = await params;
  const orgId = idSchema.parse(p.orgId);
  const access = await requireOrgAccess(orgId, "whatsapp:manage", req);
  enforceRateLimit(`wa-diagnose:${access.user.id}`, 20, 15 * 60_000);
  return ok(await diagnoseConnection(orgId, idSchema.parse(p.accountId)));
});
