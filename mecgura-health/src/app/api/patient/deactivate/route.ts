import { patientRoute } from "@/lib/api/patient-route";
import { readJson } from "@/lib/api/handler";
import { requestDeactivation } from "@/lib/services/portal-account";
export const dynamic = "force-dynamic";
export const POST = patientRoute(async ({ req, ctx }) => requestDeactivation(ctx, await readJson(req)));
