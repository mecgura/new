import { patientRoute } from "@/lib/api/patient-route";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const PATCH = patientRoute(async ({ ctx, params }) => N.markRead(N.patientActor(ctx), params.id));
