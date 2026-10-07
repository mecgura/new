import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { receivePurchase } from "@/lib/services/pharmacy-inventory";
export const dynamic = "force-dynamic";
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => receivePurchase(ctx, params.id));
