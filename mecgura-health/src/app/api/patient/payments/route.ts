import { patientRoute } from "@/lib/api/patient-route";
import { listPayments } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listPayments(ctx, { page: Number(s.get("page") ?? 1) }); });
