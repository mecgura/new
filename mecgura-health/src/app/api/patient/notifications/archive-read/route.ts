import { patientRoute } from "@/lib/api/patient-route";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const POST = patientRoute(async ({ ctx }) => N.archiveAllRead(N.patientActor(ctx)));
