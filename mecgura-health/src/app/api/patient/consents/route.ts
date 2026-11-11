import { patientRoute } from "@/lib/api/patient-route";
import { readJson } from "@/lib/api/handler";
import { getConsents, setConsent } from "@/lib/services/portal-account";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx }) => getConsents(ctx));
export const POST = patientRoute(async ({ req, ctx }) => setConsent(ctx, await readJson(req)));
