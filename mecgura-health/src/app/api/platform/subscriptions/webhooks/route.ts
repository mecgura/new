import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { webhookLog } from "@/lib/services/sub-admin";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req }) => webhookLog(ctx, Number(new URL(req.url).searchParams.get("page")) || 1));
