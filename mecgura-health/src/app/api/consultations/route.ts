import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listConsultations } from "@/lib/services/consultation";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const sp = new URL(req.url).searchParams; return listConsultations(ctx, { patientId: sp.get("patientId") ?? undefined, page: Number(sp.get("page")) || 1, mine: sp.get("mine") === "1" }); });
