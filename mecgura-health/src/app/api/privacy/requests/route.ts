import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listRightsRequests } from "@/lib/services/sec-privacy";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true, permission: "privacy.manage" }, async ({ ctx, req }) => { const q = new URL(req.url).searchParams; return listRightsRequests(ctx, { status: q.get("status") ?? undefined, page: Number(q.get("page")) || 1 }); });
