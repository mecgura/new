import { patientRoute } from "@/lib/api/patient-route";
import { cancelMyRequest } from "@/lib/services/portal-account";
export const dynamic = "force-dynamic";
export const POST = patientRoute(async ({ ctx, params }) => cancelMyRequest(ctx, params.id));
