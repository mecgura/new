import { patientRoute } from "@/lib/api/patient-route";
import { readJson } from "@/lib/api/handler";
import { bookAppointment, listAppointments } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listAppointments(ctx, { group: s.get("group") ?? undefined, page: Number(s.get("page") ?? 1) }); });
export const POST = patientRoute(async ({ req, ctx }) => bookAppointment(ctx, (await readJson(req)) as never));
