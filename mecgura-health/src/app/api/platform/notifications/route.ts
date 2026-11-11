import { apiRoute } from "@/lib/api/handler";
import { platformNotificationOverview } from "@/lib/services/notifications-platform";
export const dynamic = "force-dynamic";
export const GET = apiRoute({ permission: "platform.manage" }, async ({ req, ctx }) => { const s = new URL(req.url).searchParams; return platformNotificationOverview(ctx, { tenantId: s.get("tenantId") ?? undefined, category: s.get("category") ?? undefined, priority: s.get("priority") ?? undefined, status: s.get("status") ?? undefined, from: s.get("from") ?? undefined, to: s.get("to") ?? undefined, page: Number(s.get("page") ?? 1) }); });
