import { patientRoute } from "@/lib/api/patient-route";
import { readJson } from "@/lib/api/handler";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const PATCH = patientRoute(async ({ req, ctx, params }) => N.archive(N.patientActor(ctx), params.id, ((await readJson(req).catch(() => ({}))) as { archived?: boolean }).archived !== false));
