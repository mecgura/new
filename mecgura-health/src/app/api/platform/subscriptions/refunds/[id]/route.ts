import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { adminDecideRefund } from "@/lib/services/sub-admin";

export const dynamic = "force-dynamic";
/** { decision: APPROVED|REJECTED|CANCELLED|PROCESS, password, reference? } */
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => { await adminDecideRefund(ctx, params.id, (await readJson(req)) as Record<string, never>); return { done: true }; });
