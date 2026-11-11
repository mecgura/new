import { patientRoute } from "@/lib/api/patient-route";
import { getConsultation } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx, params }) => getConsultation(ctx, params.id));
