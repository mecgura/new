import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { issueInvoice } from "@/lib/services/billing-invoices";

export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => issueInvoice(ctx, params.id));
