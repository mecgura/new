import { cookies } from "next/headers";
import { handle, ok } from "@/lib/api";
import { audit } from "@/lib/audit";
import { ACTIVE_ORG_COOKIE, requireSuperAdmin } from "@/lib/session";

/** Leaves a client workspace opened with support access and returns to the admin area. */
export const POST = handle(async (req) => {
  const admin = await requireSuperAdmin(req);
  const jar = await cookies();
  const was = jar.get(ACTIVE_ORG_COOKIE)?.value;
  jar.delete(ACTIVE_ORG_COOKIE);
  if (was) await audit({ action: "admin.workspace_closed", actorUserId: admin.id, organizationId: was, targetType: "organization", targetId: was, req });
  return ok({ ok: true });
});
