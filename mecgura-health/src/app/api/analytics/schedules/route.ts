import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listSchedules, saveSchedule } from "@/lib/services/analytics-reports";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "analytics.view" }, async ({ ctx }) => listSchedules(ctx));
export const POST = apiRoute<TenantRequestContext>({ tenant: true, permission: "analytics.configure" }, async ({ ctx, req }) => saveSchedule(ctx, await readJson(req)));
