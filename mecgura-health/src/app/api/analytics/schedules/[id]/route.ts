import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { deleteSchedule } from "@/lib/services/analytics-reports";

export const dynamic = "force-dynamic";
export const DELETE = apiRoute<TenantRequestContext>({ tenant: true, permission: "analytics.configure" }, async ({ ctx, params }) => deleteSchedule(ctx, params.id));
