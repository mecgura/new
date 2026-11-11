import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { saveInvestigation, searchInvestigations } from "@/lib/services/lab-master";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return searchInvestigations(ctx, { q: s.get("q") ?? undefined, category: s.get("category") ?? undefined, all: s.get("all") === "1" }); });
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => saveInvestigation(ctx, null, await readJson(req)));
