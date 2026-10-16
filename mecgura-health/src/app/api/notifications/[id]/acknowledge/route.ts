import { apiRoute } from "@/lib/api/handler";
import * as N from "@/lib/services/notifications";
export const dynamic = "force-dynamic";
export const POST = apiRoute({}, async ({ ctx, params }) => N.acknowledge(N.staffActor(ctx), params.id));
