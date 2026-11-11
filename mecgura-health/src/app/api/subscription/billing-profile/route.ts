import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { saveBillingProfile } from "@/lib/services/sub-pay";

export const dynamic = "force-dynamic";
export const PUT = apiRoute<TenantRequestContext>({ tenant: true, permission: "subscription.manage" }, async ({ req, ctx }) => saveBillingProfile(ctx, await readJson(req)));
