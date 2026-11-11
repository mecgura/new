import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { choosePlan } from "@/lib/services/sub-core";

export const dynamic = "force-dynamic";
/** Start a trial, or get the first invoice, for a public plan. Charges nothing by itself. */
export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "subscription.manage" }, async ({ req, ctx }) => choosePlan(ctx, (await readJson(req)) as Record<string, never>));
