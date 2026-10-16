import { patientRoute } from "@/lib/api/patient-route";
import { getAppointment } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx, params }) => getAppointment(ctx, params.id));
