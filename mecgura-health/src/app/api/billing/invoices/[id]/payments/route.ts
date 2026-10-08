import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { recordPayment } from "@/lib/services/billing-payments";

export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => recordPayment(ctx, params.id, await readJson(req)));
