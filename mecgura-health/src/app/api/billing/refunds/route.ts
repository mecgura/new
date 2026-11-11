import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listRefunds, requestRefund } from "@/lib/services/billing-payments";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listRefunds(ctx, { status: s.get("status") ?? undefined, q: s.get("q") ?? undefined, page: Number(s.get("page")) || 1 }); });
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => requestRefund(ctx, await readJson(req)));
