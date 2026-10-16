import { patientRoute } from "@/lib/api/patient-route";
import * as N from "@/lib/services/notifications";
import { syncNotifications } from "@/lib/services/portal-account";
export const dynamic = "force-dynamic";
export const GET = patientRoute(async ({ req, ctx }) => { await syncNotifications(ctx).catch(() => undefined); return N.listNotifications(N.patientActor(ctx), Object.fromEntries(new URL(req.url).searchParams)); });
