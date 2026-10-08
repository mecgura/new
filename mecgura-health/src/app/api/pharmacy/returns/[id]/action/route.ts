import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { returnAction } from "@/lib/services/pharmacy-dispensing";
export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => returnAction(ctx, params.id, await readJson(req)));
