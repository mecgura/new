import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { reviewPatientRequest } from "@/lib/services/portal-admin";
export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => reviewPatientRequest(ctx, params.id, await readJson(req)));
