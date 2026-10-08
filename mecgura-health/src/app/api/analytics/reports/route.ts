import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { reportCatalog } from "@/lib/services/analytics-reports";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "analytics.view" }, async ({ ctx }) => reportCatalog(ctx));
