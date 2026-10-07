import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listSuppliers, saveSupplier } from "@/lib/services/pharmacy-master";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listSuppliers(ctx, { q: s.get("q") ?? undefined, all: s.get("all") === "1", page: Number(s.get("page") ?? 1) }); });
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => saveSupplier(ctx, null, await readJson(req)));
