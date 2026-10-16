import { apiRoute, readJson } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { prescriptionSummary } from "@/lib/services/prescription";
import { loadConsultation } from "@/lib/services/consultation";
import { savePrescriptionDraft } from "@/lib/services/prescription";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ ctx, params }) => { await loadConsultation(ctx, params.id, "read"); return prescriptionSummary(ctx, params.id, true); });
export const PUT = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => savePrescriptionDraft(ctx, params.id, await readJson(req)));
