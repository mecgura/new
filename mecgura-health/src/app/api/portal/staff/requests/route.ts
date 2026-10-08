import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listPatientRequests } from "@/lib/services/portal-admin";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listPatientRequests(ctx, { status: s.get("status") ?? undefined, kind: s.get("kind") ?? undefined, q: s.get("q") ?? undefined, page: Number(s.get("page") ?? 1) }); });
