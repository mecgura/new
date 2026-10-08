import { apiRoute } from "@/lib/api/handler";
import { publicPlans } from "@/lib/services/sub-plans";

export const dynamic = "force-dynamic";
/** The public price list — straight from the plan records (ACTIVE + public only). */
export const GET = apiRoute<null>({ auth: false }, async () => publicPlans());
