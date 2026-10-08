import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { adminVoidInvoice } from "@/lib/services/sub-admin";

export const dynamic = "force-dynamic";
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => { await adminVoidInvoice(ctx, params.id, (await readJson(req)) as Record<string, never>); return { voided: true }; });
