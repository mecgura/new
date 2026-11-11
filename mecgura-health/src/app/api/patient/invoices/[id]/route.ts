import { patientRoute } from "@/lib/api/patient-route";
import { getInvoice } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx, params }) => getInvoice(ctx, params.id));
