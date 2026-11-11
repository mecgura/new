import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { releaseLegalHold } from "@/lib/services/sec-audit";

export const dynamic = "force-dynamic";
export const POST = apiRoute<RequestContext>({}, async ({ ctx, req, params }) => { await releaseLegalHold(ctx, params.id, ((await readJson(req)) as { note?: string }).note); return { released: true }; });
