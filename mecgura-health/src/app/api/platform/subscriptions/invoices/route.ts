import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { allInvoices } from "@/lib/services/sub-admin";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => { const q = new URL(req.url).searchParams; return allInvoices(ctx, { status: q.get("status") ?? undefined, q: q.get("q") ?? undefined, page: Number(q.get("page")) || 1 }); });
