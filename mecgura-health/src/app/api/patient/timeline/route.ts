import { patientRoute } from "@/lib/api/patient-route";
import { myTimeline } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx }) => myTimeline(ctx));
