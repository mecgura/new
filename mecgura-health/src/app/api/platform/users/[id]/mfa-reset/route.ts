import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { adminResetMfa } from "@/lib/services/sec-mfa";
import { requireReason, stepUp } from "@/lib/services/platform-core";

export const dynamic = "force-dynamic";
export const POST = apiRoute<RequestContext>({ permission: "platform.manage" }, async ({ ctx, req, params }) => { const b = (await readJson(req)) as { password?: string; reason?: string }; await stepUp(ctx, b.password, "mfa_reset"); await adminResetMfa(ctx, params.id, requireReason(b.reason, 10)); return { reset: true }; });
