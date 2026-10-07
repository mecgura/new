import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { saveInvestigation } from "@/lib/services/lab-master";

export const dynamic = "force-dynamic";
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => saveInvestigation(ctx, params.id, await readJson(req)));
