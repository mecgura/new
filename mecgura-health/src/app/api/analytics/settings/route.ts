import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getAnalyticsSettings, updateAnalyticsSettings } from "@/lib/services/analytics-command";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "analytics.view" }, async ({ ctx }) => getAnalyticsSettings(ctx));
export const PUT = apiRoute<TenantRequestContext>({ tenant: true, permission: "analytics.configure" }, async ({ ctx, req }) => updateAnalyticsSettings(ctx, await readJson(req)));
