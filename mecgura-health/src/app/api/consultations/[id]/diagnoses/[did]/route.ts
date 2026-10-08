import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { removeDiagnosis, updateDiagnosis } from "@/lib/services/consultation";

export const dynamic = "force-dynamic";
export const PATCH = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => updateDiagnosis(ctx, params.id, params.did, await readJson(req)));
export const DELETE = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => removeDiagnosis(ctx, params.id, params.did));
