import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getItem, updateItem } from "@/lib/services/website-items";

export const dynamic = "force-dynamic";

export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "website.view" }, async ({ ctx, params }) => getItem(ctx, params.resource, params.id));
export const PATCH = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => updateItem(ctx, params.resource, params.id, await readJson(req)));
