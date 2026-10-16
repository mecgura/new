import { apiRoute } from "@/lib/api/handler";
import { publicTenantId } from "@/lib/api/public";
import { publicBookingOptions } from "@/lib/services/appointments";

export const dynamic = "force-dynamic";
export const GET = apiRoute<null>({ auth: false }, async ({ req }) => publicBookingOptions(await publicTenantId(req)));
