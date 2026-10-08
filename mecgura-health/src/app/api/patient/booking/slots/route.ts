import { patientRoute } from "@/lib/api/patient-route";
import { bookingSlots } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return bookingSlots(ctx, s.get("doctor") ?? "", s.get("date") ?? ""); });
