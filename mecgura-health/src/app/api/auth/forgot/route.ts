import { apiRoute, readJson } from "@/lib/api/handler";
import { requestPasswordReset } from "@/lib/services/sec-account";

export const dynamic = "force-dynamic";
/** Public. Always answers { sent: true } so it can't be used to discover which emails have accounts. */
export const POST = apiRoute<null>({ auth: false }, async ({ req }) => requestPasswordReset(((await readJson(req)) as { email?: string }).email));
