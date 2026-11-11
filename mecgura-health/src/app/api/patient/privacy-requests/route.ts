import { patientRoute } from "@/lib/api/patient-route";
import { readJson } from "@/lib/api/handler";
import { submitRightsRequest } from "@/lib/services/sec-privacy";

export const dynamic = "force-dynamic";
export const POST = patientRoute(async ({ req, ctx }) => submitRightsRequest(ctx, (await readJson(req)) as Record<string, string>));
