import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getCount, saveCountLines } from "@/lib/services/pharmacy-inventory";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => getCount(ctx, params.id));
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => saveCountLines(ctx, params.id, await readJson(req)));
