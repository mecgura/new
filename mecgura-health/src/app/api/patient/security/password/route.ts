import { patientRoute } from "@/lib/api/patient-route";
import { readJson } from "@/lib/api/handler";
import { changePortalPassword } from "@/lib/services/portal-auth";
export const dynamic = "force-dynamic";
export const POST = patientRoute(async ({ req, ctx }) => changePortalPassword(ctx, await readJson(req)));
