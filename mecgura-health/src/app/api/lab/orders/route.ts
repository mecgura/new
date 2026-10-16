import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listLabOrders } from "@/lib/services/lab-orders";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listLabOrders(ctx, { tab: s.get("tab") ?? undefined, q: s.get("q") ?? undefined, priority: s.get("priority") ?? undefined, patientId: s.get("patientId") ?? undefined, consultationId: s.get("consultationId") ?? undefined, page: Number(s.get("page")) || 1 }); });
