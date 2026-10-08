import { apiRoute, readJson } from "@/lib/api/handler";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const PATCH = apiRoute({}, async ({ req, ctx, params }) => N.archive(N.staffActor(ctx), params.id, ((await readJson(req).catch(() => ({}))) as { archived?: boolean }).archived !== false));
