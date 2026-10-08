import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listServices, saveService } from "@/lib/services/billing-master";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listServices(ctx, { q: s.get("q") ?? undefined, type: s.get("type") ?? undefined, all: s.get("all") === "1" }); });
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => saveService(ctx, null, await readJson(req)));
