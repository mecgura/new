import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { addTax, listTaxes } from "@/lib/services/billing-master";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => listTaxes(ctx));
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => addTax(ctx, await readJson(req)));
