import { patientRoute } from "@/lib/api/patient-route";
import { readJson } from "@/lib/api/handler";
import { createRequest, listMyRequests } from "@/lib/services/portal-account";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ ctx }) => listMyRequests(ctx));
export const POST = patientRoute(async ({ req, ctx }) => createRequest(ctx, await readJson(req)));
