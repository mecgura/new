import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { setTaxActive } from "@/lib/services/billing-master";

export const dynamic = "force-dynamic";
export const PATCH = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => setTaxActive(ctx, params.id, !!((await readJson(req)) as { active?: unknown }).active));
