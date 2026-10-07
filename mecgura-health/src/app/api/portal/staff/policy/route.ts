import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getPortalPolicy, savePortalPolicy } from "@/lib/services/portal-admin";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => getPortalPolicy(ctx));
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => savePortalPolicy(ctx, await readJson(req)));
