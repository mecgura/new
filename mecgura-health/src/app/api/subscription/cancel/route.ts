import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { cancelSubscription } from "@/lib/services/sub-core";

export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "subscription.manage" }, async ({ req, ctx }) => cancelSubscription(ctx, (await readJson(req)) as { reason?: string; notes?: string }));
