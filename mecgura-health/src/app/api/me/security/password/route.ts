import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { changePassword } from "@/lib/services/sec-account";

export const dynamic = "force-dynamic";
export const POST = apiRoute<RequestContext>({}, async ({ req, ctx }) => changePassword(ctx, (await readJson(req)) as Record<string, string>));
