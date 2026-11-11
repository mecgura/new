import { apiRoute } from "@/lib/api/handler";
import type { TenantRequestContext } from "@/lib/auth/context";
import { patientTimeline } from "@/lib/services/patient-crm";

export const dynamic = "force-dynamic";
export const GET = apiRoute<TenantRequestContext>({ tenant: true }, async ({ req, ctx, params }) => patientTimeline(ctx, params.id, Object.fromEntries(new URL(req.url).searchParams)));
