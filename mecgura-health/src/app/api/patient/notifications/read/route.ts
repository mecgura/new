import { patientRoute } from "@/lib/api/patient-route";
import { readJson } from "@/lib/api/handler";
import { markNotificationsRead } from "@/lib/services/portal-account";
export const dynamic = "force-dynamic";
export const POST = patientRoute(async ({ req, ctx }) => { const b = (await readJson(req)) as { id?: string }; return markNotificationsRead(ctx, typeof b.id === "string" ? b.id : undefined); });
