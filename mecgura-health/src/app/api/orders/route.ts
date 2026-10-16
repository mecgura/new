import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listOrders } from "@/lib/services/orders";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => listOrders(ctx, { status: new URL(req.url).searchParams.get("status") ?? undefined }));
