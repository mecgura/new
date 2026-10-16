import { patientRoute } from "@/lib/api/patient-route";
import { helpInfo } from "@/lib/services/portal-account";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx }) => helpInfo(ctx));
