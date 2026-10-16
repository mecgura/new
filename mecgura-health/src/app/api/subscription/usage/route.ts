import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { usageSnapshot } from "@/lib/services/entitlements";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "subscription.view" }, async ({ ctx }) => usageSnapshot(ctx.tenantId));
