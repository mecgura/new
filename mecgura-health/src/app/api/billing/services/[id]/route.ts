import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { saveService } from "@/lib/services/billing-master";

export const dynamic = "force-dynamic";
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => saveService(ctx, params.id, await readJson(req)));
