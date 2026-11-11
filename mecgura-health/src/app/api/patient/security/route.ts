import { patientRoute } from "@/lib/api/patient-route";
import { securityOverview } from "@/lib/services/portal-auth";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx }) => securityOverview(ctx));
