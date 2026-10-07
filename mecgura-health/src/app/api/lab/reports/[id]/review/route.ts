import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { reviewReport } from "@/lib/services/lab-results";

export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => reviewReport(ctx, params.id, await readJson(req)));
