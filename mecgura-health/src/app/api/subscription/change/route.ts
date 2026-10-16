import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { changePlan, clearScheduledChange, previewChange } from "@/lib/services/sub-core";

export const dynamic = "force-dynamic";
/** { planId, interval, confirm? } — without `confirm` it only PREVIEWS (what changes, what is charged, what the usage check says). */
export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "subscription.manage" }, async ({ req, ctx }) => {
  const b = (await readJson(req)) as { planId?: string; interval?: string; confirm?: boolean };
  return b.confirm === true ? { applied: true, ...(await changePlan(ctx, b)) } : { applied: false, preview: await previewChange(ctx, b) };
});
export const DELETE = apiRoute<TenantRequestContext>({ tenant: true, permission: "subscription.manage" }, async ({ ctx }) => { await clearScheduledChange(ctx); return { cleared: true }; });
