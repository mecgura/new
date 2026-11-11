import { patientRoute } from "@/lib/api/patient-route";
import { listFollowUps } from "@/lib/services/portal-records";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return listFollowUps(ctx, { group: s.get("group") ?? undefined }); });
