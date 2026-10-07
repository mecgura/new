import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { pharmacyDashboard } from "@/lib/services/pharmacy-reports";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx }) => pharmacyDashboard(ctx));
