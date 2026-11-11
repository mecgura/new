import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { selectablePlans } from "@/lib/services/sub-plans";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "subscription.view" }, async ({ ctx }) => selectablePlans(ctx.tenantId));
