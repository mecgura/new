import { apiRoute } from "@/lib/api/handler";
import { platformCommOverview } from "@/lib/services/comms-platform";
export const dynamic = "force-dynamic";
export const GET = apiRoute({ permission: "platform.manage" }, async ({ req, ctx }) => platformCommOverview(ctx, Number(new URL(req.url).searchParams.get("days") ?? 7) || 7));
