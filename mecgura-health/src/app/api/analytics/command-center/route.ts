import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { queryFromSearchParams } from "@/lib/services/analytics-core";
import { commandCenter } from "@/lib/services/analytics-command";

export const dynamic = "force-dynamic";
/** KPIs the signed-in user is allowed to see. Tenant and doctor scope come from the session, never from the query string. */
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "analytics.view" }, async ({ ctx, req }) => commandCenter(ctx, queryFromSearchParams(new URL(req.url).searchParams)));
