import { patientRoute } from "@/lib/api/patient-route";
import { listNotifications } from "@/lib/services/portal-account";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx }) => listNotifications(ctx));
