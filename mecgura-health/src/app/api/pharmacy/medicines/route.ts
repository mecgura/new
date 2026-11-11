import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { createMedicine, listMedicines } from "@/lib/services/pharmacy-master";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listMedicines(ctx, { q: s.get("q") ?? undefined, category: s.get("category") ?? undefined, status: s.get("status") ?? undefined, page: Number(s.get("page") ?? 1) }); });
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => createMedicine(ctx, await readJson(req)));
