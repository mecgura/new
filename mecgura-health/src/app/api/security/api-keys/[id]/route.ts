import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { revokeApiKey, rotateApiKey } from "@/lib/services/sec-apikeys";

export const dynamic = "force-dynamic";
/** { action: "revoke" | "rotate", password } */
export const POST = apiRoute<RequestContext>({}, async ({ ctx, req, params }) => { const b = (await readJson(req)) as { action?: string; password?: string }; return b.action === "rotate" ? rotateApiKey(ctx, params.id, b.password) : revokeApiKey(ctx, params.id, b.password); });
