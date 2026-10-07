import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { createRecall, listRecalls } from "@/lib/services/recalls";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listRecalls(ctx, { status: s.get("status") ?? undefined, q: s.get("q") ?? undefined, patientId: s.get("patientId") ?? undefined, page: Number(s.get("page")) || 1 }); });
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => createRecall(ctx, await readJson(req)));
