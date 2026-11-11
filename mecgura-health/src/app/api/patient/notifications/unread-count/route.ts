import { patientRoute } from "@/lib/api/patient-route";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx }) => N.unreadCount(N.patientActor(ctx)));
