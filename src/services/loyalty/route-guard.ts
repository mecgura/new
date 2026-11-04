import { orgRoute } from "@/lib/route-helpers";
import type { OrgPermission } from "@/lib/authz";
import { assertServiceEnabled } from "@/services/whatsapp/guards";

/** Tenant + permission check, then the Referral & loyalty service must be on for this client. */
export async function loyaltyRoute<P extends Record<string, string>>(req: Request, params: Promise<P>, permission: OrgPermission) {
  const r = await orgRoute(req, params, permission);
  await assertServiceEnabled(r.access.organizationId, "LOYALTY");
  const ctx = { organizationId: r.access.organizationId, actorUserId: r.access.user.id, req };
  return { ...r, ctx };
}
