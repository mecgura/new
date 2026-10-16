import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { subscriptionDetail } from "@/lib/services/sub-admin";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, params }) => subscriptionDetail(ctx, params.tenantId));
