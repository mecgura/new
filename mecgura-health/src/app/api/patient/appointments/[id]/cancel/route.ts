import { patientRoute } from "@/lib/api/patient-route";
import { readJson } from "@/lib/api/handler";
import { cancelAppointment } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const POST = patientRoute(async ({ req, ctx, params }) => cancelAppointment(ctx, params.id, await readJson(req)));
