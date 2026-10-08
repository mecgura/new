import { apiRoute } from "@/lib/api/handler";
import * as N from "@/lib/services/notifications";
import { platformHealth } from "@/lib/notifications/jobs";
export const dynamic = "force-dynamic";
export const GET = apiRoute({}, async ({ ctx }) => { if (ctx.user.role === "SUPER_ADMIN") await platformHealth().catch(() => 0); return N.unreadCount(N.staffActor(ctx)); });
