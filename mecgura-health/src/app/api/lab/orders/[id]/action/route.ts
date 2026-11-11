import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { labOrderAction } from "@/lib/services/lab-orders";
import { isReportAction, reportAction } from "@/lib/services/lab-results";

export const dynamic = "force-dynamic";
/** One endpoint for lab workflow actions; sample actions and report actions are handled by their own services. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => { const body = await readJson(req); return isReportAction(String((body as { action?: unknown })?.action)) ? reportAction(ctx, params.id, body) : labOrderAction(ctx, params.id, body); });
