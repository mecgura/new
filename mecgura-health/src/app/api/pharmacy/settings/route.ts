import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getPharmacySettings, savePharmacySettings } from "@/lib/services/pharmacy-master";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => ({ ...(await getPharmacySettings(ctx)), canConfigure: ctx.permissions.has("pharmacy.configure") }));
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => savePharmacySettings(ctx, await readJson(req)));
