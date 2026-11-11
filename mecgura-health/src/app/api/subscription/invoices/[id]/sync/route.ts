import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { syncInvoicePayment } from "@/lib/services/sub-pay";

export const dynamic = "force-dynamic";
/** Re-checks the invoice with the payment provider (the redirect back from the payment page proves nothing). */
export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "subscription.view" }, async ({ ctx, params }) => syncInvoicePayment(ctx.tenantId, params.id));
