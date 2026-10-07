import { patientRoute } from "@/lib/api/patient-route";
import { logoutEverywhere } from "@/lib/services/portal-auth";
export const dynamic = "force-dynamic";
export const POST = patientRoute(async ({ ctx }) => logoutEverywhere(ctx));
