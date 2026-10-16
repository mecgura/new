import { apiRoute } from "@/lib/api/handler";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const GET = apiRoute({}, async ({ ctx, params }) => N.getNotification(N.staffActor(ctx), params.id));
