import { apiRoute, readJson } from "@/lib/api/handler";
import { clientIp, publicTenantId } from "@/lib/api/public";
import { createPublicBooking } from "@/lib/services/appointments";

export const dynamic = "force-dynamic";
/** Anonymous booking from the clinic website. Clinic = HOST; doctor = published slug; slot is re-validated server-side. */
export const POST = apiRoute<null>({ auth: false }, async ({ req }) => createPublicBooking(await publicTenantId(req), await readJson(req), clientIp(req)));
