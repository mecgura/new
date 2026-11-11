import { patientRoute } from "@/lib/api/patient-route";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx, params }) => N.getNotification(N.patientActor(ctx), params.id, { markRead: true }));
