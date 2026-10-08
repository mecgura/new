import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

/** Reference authenticated endpoint: who am I, which workspace, what may I do. */
export const GET = apiRoute<RequestContext>({}, async ({ ctx }) => ({
  user: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role },
  workspace: ctx.tenant ? { id: ctx.tenant.id, name: ctx.tenant.name, slug: ctx.tenant.slug } : null,
  permissions: Array.from(ctx.permissions).sort(),
  modules: ctx.enabledModules,
}));
