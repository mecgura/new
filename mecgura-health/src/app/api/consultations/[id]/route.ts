import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { getConsultation, patchConsultation } from "@/lib/services/consultation";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => getConsultation(ctx, params.id));
export const PATCH = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => patchConsultation(ctx, params.id, await readJson(req)));
