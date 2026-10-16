import { patientRoute } from "@/lib/api/patient-route";
import { myCommunications } from "@/lib/services/portal-comms";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx }) => myCommunications(ctx));
