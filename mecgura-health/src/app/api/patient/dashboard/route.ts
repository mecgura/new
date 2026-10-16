import { patientRoute } from "@/lib/api/patient-route";
import { dashboard } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx }) => dashboard(ctx));
