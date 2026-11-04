import { orgRoute } from "@/lib/route-helpers";
import type { OrgPermission } from "@/lib/authz";
import { assertServiceEnabled } from "@/services/whatsapp/guards";

/** Tenant + permission check, then the Landing pages service must be on for this client. */
export async function pagesRoute<P extends Record<string, string>>(req: Request, params: Promise<P>, permission: OrgPermission) {
  const r = await orgRoute(req, params, permission);
  await assertServiceEnabled(r.access.organizationId, "LANDING_PAGES");
  return { ...r, ctx: { organizationId: r.access.organizationId, actorUserId: r.access.user.id, req } };
}
