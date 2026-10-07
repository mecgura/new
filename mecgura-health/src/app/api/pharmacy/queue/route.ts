import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { prescriptionQueue } from "@/lib/services/pharmacy-dispensing";
export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return prescriptionQueue(ctx, { status: s.get("status") ?? undefined, q: s.get("q") ?? undefined, page: Number(s.get("page") ?? 1) }); });
