import { apiRoute, readJson } from "@/lib/api/handler";
import { completePasswordReset } from "@/lib/services/sec-account";

export const dynamic = "force-dynamic";
export const POST = apiRoute<null>({ auth: false }, async ({ req }) => completePasswordReset((await readJson(req)) as Record<string, string>));
