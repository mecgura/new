import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { saveResults } from "@/lib/services/lab-results";

export const dynamic = "force-dynamic";
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => saveResults(ctx, params.id, params.itemId, await readJson(req)));
