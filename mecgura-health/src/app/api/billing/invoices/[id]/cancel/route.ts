import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { cancelInvoice } from "@/lib/services/billing-invoices";

export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => cancelInvoice(ctx, params.id, await readJson(req)));
