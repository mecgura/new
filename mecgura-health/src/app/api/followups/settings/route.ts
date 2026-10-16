import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getSettings, updateSettings } from "@/lib/services/followups";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => getSettings(ctx));
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => updateSettings(ctx, await readJson(req)));
