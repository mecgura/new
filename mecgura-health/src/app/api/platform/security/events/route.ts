import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { listSecurityEvents } from "@/lib/services/sec-center";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => { const q = new URL(req.url).searchParams; return listSecurityEvents(ctx, { severity: q.get("severity") ?? undefined, category: q.get("category") ?? undefined, type: q.get("type") ?? undefined, tenantId: q.get("tenantId") ?? undefined, from: q.get("from") ?? undefined, page: Number(q.get("page")) || 1 }); });
