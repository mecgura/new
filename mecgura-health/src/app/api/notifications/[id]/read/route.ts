import { apiRoute } from "@/lib/api/handler";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const PATCH = apiRoute({}, async ({ ctx, params }) => N.markRead(N.staffActor(ctx), params.id));
