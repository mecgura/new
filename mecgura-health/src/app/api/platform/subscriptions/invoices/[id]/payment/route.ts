import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { recordManualPayment } from "@/lib/services/sub-pay";

export const dynamic = "force-dynamic";
/** Offline payment received by MECGURA (bank transfer, UPI, cheque). Re-authenticated, reasoned, idempotent on the reference. */
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => recordManualPayment(ctx, params.id, (await readJson(req)) as Record<string, never>));
