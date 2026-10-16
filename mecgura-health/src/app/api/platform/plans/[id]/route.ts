import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { getPlanForAdmin, savePlan } from "@/lib/services/sub-plans";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, params }) => getPlanForAdmin(ctx, params.id));
export const PUT = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => savePlan(ctx, params.id, await readJson(req)));
