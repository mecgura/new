import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { setConfigActive } from "@/lib/services/lab-master";

export const dynamic = "force-dynamic";
export const PATCH = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => setConfigActive(ctx, params.id, !!((await readJson(req)) as { active?: unknown }).active));
