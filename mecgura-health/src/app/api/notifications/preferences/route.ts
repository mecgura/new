import { apiRoute, readJson } from "@/lib/api/handler";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const GET = apiRoute({}, async ({ ctx }) => N.getPreferences(N.staffActor(ctx)));
export const PATCH = apiRoute({}, async ({ req, ctx }) => N.savePreferences(N.staffActor(ctx), await readJson(req)));
