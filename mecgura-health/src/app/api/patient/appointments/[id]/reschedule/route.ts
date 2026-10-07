import { patientRoute } from "@/lib/api/patient-route";
import { readJson } from "@/lib/api/handler";
import { rescheduleAppointment } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const POST = patientRoute(async ({ req, ctx, params }) => rescheduleAppointment(ctx, params.id, await readJson(req)));
