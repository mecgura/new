import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getFamily, linkFamily, unlinkFamily } from "@/lib/services/patient-records";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => getFamily(ctx, params.id));
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => linkFamily(ctx, params.id, await readJson(req)));
export const DELETE = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => unlinkFamily(ctx, params.id));
