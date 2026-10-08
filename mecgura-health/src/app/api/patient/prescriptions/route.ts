import { patientRoute } from "@/lib/api/patient-route";
import { listPrescriptions } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listPrescriptions(ctx, { page: Number(s.get("page") ?? 1), from: s.get("from") ?? undefined, to: s.get("to") ?? undefined }); });
