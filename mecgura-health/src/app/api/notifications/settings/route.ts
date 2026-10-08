import { apiRoute, readJson } from "@/lib/api/handler";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const PUT = apiRoute({}, async ({ req, ctx }) => N.saveSettings(ctx, await readJson(req)));
