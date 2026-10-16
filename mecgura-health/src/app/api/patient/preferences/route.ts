import { patientRoute } from "@/lib/api/patient-route";
import { readJson } from "@/lib/api/handler";
import { getPreferences, savePreferences } from "@/lib/services/portal-account";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx }) => getPreferences(ctx));
export const PUT = patientRoute(async ({ req, ctx }) => savePreferences(ctx, await readJson(req)));
