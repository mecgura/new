import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { createFollowUp, listFollowUps } from "@/lib/services/followups";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listFollowUps(ctx, { tab: s.get("tab") ?? undefined, q: s.get("q") ?? undefined, doctorId: s.get("doctorId") ?? undefined, assignedTo: s.get("assignedTo") ?? undefined, priority: s.get("priority") ?? undefined, type: s.get("type") ?? undefined, status: s.get("status") ?? undefined, source: s.get("source") ?? undefined, date: s.get("date") ?? undefined, patientId: s.get("patientId") ?? undefined, consultationId: s.get("consultationId") ?? undefined, page: Number(s.get("page")) || 1 }); });
export const POST = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx }) => createFollowUp(ctx, await readJson(req)));
