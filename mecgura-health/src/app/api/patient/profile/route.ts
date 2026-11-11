import { patientRoute } from "@/lib/api/patient-route";
import { readJson } from "@/lib/api/handler";
import { getProfile, updateProfile } from "@/lib/services/portal-account";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx }) => getProfile(ctx));
export const PATCH = patientRoute(async ({ req, ctx }) => updateProfile(ctx, await readJson(req)));
