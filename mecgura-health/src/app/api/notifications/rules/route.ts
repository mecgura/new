import { apiRoute, readJson } from "@/lib/api/handler";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const GET = apiRoute({}, async ({ ctx }) => N.getRules(ctx));
export const PUT = apiRoute({}, async ({ req, ctx }) => N.saveRule(ctx, await readJson(req)));
export const DELETE = apiRoute({}, async ({ req, ctx }) => N.resetRule(ctx, String(new URL(req.url).searchParams.get("type") ?? "")));
