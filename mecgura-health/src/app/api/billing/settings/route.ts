import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getBillingSettings, updateBillingSettings } from "@/lib/services/billing-master";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => getBillingSettings(ctx));
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => updateBillingSettings(ctx, await readJson(req)));
