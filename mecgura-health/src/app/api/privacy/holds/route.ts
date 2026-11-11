import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { listLegalHolds, placeLegalHold } from "@/lib/services/sec-audit";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({}, async ({ ctx, req }) => listLegalHolds(ctx, new URL(req.url).searchParams.get("tenantId") ?? undefined));
export const POST = apiRoute<RequestContext>({}, async ({ ctx, req }) => placeLegalHold(ctx, (await readJson(req)) as Record<string, string>));
