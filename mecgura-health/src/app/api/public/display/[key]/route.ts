import { apiRoute } from "@/lib/api/handler";
import { displaySnapshot } from "@/lib/services/opd";

export const dynamic = "force-dynamic";
/** Waiting-room screen data: tokens only, never patient names. Protected by the clinic's secret display key. */
export const GET = apiRoute<null>({ auth: false }, async ({ params }) => displaySnapshot(params.key));
