import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { billingDashboard } from "@/lib/services/billing-reports";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => billingDashboard(ctx));
