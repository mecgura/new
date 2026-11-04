import { handle, ok } from "@/lib/api";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { verifyIntegration } from "@/services/admin/readiness";

export const maxDuration = 30;
type Ctx = { params: Promise<{ key: string }> };

/** Sends one real verification request to the provider and stores the result. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const { key } = await params;
  const result = await verifyIntegration(key);
  await audit({ action: "integration.verified", actorUserId: admin.id, targetType: "integration", targetId: key, metadata: { ok: result.ok }, req });
  return ok({ result });
});
