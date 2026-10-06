import { z } from "zod";
import { apiRoute, readJson } from "@/lib/api/handler";
import { clearWorkspaceCookie, setWorkspaceCookie } from "@/lib/auth/workspace";
import type { RequestContext } from "@/lib/auth/context";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { assertCanEnterClinic } from "@/lib/services/clinics";
import { parseOrThrow } from "@/lib/validation";

/** Super Admin enters a clinic workspace. Body: { tenantId }. Audited. */
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ req, ctx }) => {
  const { tenantId } = parseOrThrow(z.object({ tenantId: z.string().min(1) }), await readJson(req));
  await assertCanEnterClinic(ctx, tenantId);
  await setWorkspaceCookie(ctx.user.id, tenantId);
  return { entered: tenantId };
});

export const DELETE = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx }) => {
  if (ctx.tenant) await recordAudit({ action: AUDIT_ACTIONS.TENANT_EXITED, tenantId: ctx.tenant.id, actorId: ctx.user.id, entityType: "tenant", entityId: ctx.tenant.id });
  await clearWorkspaceCookie();
  return { exited: true };
});
