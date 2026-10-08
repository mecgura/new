import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { listSubscriptions } from "@/lib/services/sub-admin";

export const dynamic = "force-dynamic";
const sp = (req: Request) => new URL(req.url).searchParams;
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => { const q = sp(req); return listSubscriptions(ctx, { q: q.get("q") ?? undefined, status: q.get("status") ?? undefined, planId: q.get("planId") ?? undefined, source: q.get("source") ?? undefined, page: Number(q.get("page")) || 1 }); });
