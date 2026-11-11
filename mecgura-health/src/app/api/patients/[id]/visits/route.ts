import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { listPatientVisits } from "@/lib/services/patient-crm";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => listPatientVisits(ctx, params.id, Number(new URL(req.url).searchParams.get("page")) || 1));
