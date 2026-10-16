import { apiRoute } from "@/lib/api/handler";
import { platformAnalytics } from "@/lib/services/analytics-command";

export const dynamic = "force-dynamic";
/** Super Admin only: clinic counts and platform status. */
export const GET = apiRoute({ permission: "platform.manage" }, async ({ ctx }) => platformAnalytics(ctx));
