import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listDispensings } from "@/lib/services/pharmacy-dispensing";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listDispensings(ctx, { q: s.get("q") ?? undefined, status: s.get("status") ?? undefined, from: s.get("from") ?? undefined, to: s.get("to") ?? undefined, patientId: s.get("patientId") ?? undefined, page: Number(s.get("page") ?? 1) }); });
