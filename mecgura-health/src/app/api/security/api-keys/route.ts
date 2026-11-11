import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { createApiKey, listApiKeys } from "@/lib/services/sec-apikeys";

export const dynamic = "force-dynamic";
/** The signed-in user's own scope: a clinic admin sees their clinic's keys; a Super Admin (outside any clinic) sees platform keys. */
export const GET = apiRoute<RequestContext>({}, async ({ ctx }) => listApiKeys(ctx));
export const POST = apiRoute<RequestContext>({}, async ({ ctx, req }) => createApiKey(ctx, (await readJson(req)) as Record<string, never>));
