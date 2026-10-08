import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { queryFromSearchParams } from "@/lib/services/analytics-core";
import { runReport } from "@/lib/services/analytics-reports";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "analytics.view" }, async ({ ctx, req, params }) => runReport(ctx, params.key, queryFromSearchParams(new URL(req.url).searchParams)));
