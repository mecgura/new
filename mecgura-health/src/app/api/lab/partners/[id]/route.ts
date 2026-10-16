import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { setPartnerActive } from "@/lib/services/lab-master";

export const dynamic = "force-dynamic";
export const PATCH = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => setPartnerActive(ctx, params.id, !!((await readJson(req)) as { active?: unknown }).active));
