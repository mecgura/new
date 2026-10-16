import { apiRoute, readJson } from "@/lib/api/handler";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const POST = apiRoute({}, async ({ req, ctx }) => N.markAllRead(N.staffActor(ctx), ((await readJson(req).catch(() => ({}))) as { category?: string }).category));
