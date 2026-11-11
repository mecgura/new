import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { clinicOverview } from "@/lib/services/sub-core";

export const dynamic = "force-dynamic";
/** The signed-in clinic's own subscription, usage, invoices and payments. The clinic comes from the session, never from the URL. */
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "subscription.view" }, async ({ ctx }) => clinicOverview(ctx));
