import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { startCheckout } from "@/lib/services/sub-pay";

export const dynamic = "force-dynamic";
/** Opens the provider's hosted payment page for THIS clinic's invoice. The amount is the server's, not the browser's. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "subscription.manage" }, async ({ ctx, params }) => startCheckout(ctx, params.id));
