import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { applyCount } from "@/lib/services/pharmacy-inventory";
export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => applyCount(ctx, params.id));
