import { z } from "zod";
import { apiRoute, readJson } from "@/lib/api/handler";
import { clearWorkspaceCookie, setWorkspaceCookie } from "@/lib/auth/workspace";
import type { RequestContext } from "@/lib/auth/context";
import { endSupportAccess, startSupportAccess } from "@/lib/services/platform-admin";
import { parseOrThrow } from "@/lib/validation";

/** Support access: a Super Admin enters a clinic workspace only with a stated reason and their own password. The visit is time-limited, audited and always shown in a banner. */
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ req, ctx }) => {
  const b = parseOrThrow(z.object({ tenantId: z.string().min(1).max(40), reason: z.string().max(500).optional(), password: z.string().max(200).optional() }), await readJson(req));
  const visit = await startSupportAccess(ctx, b.tenantId, b);
  await setWorkspaceCookie(ctx.user.id, b.tenantId);
  return { entered: b.tenantId, expiresAt: visit.expiresAt };
});

export const DELETE = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx }) => {
  await endSupportAccess(ctx);
  await clearWorkspaceCookie();
  return { exited: true };
});
