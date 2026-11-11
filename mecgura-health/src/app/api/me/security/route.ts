import { apiRoute } from "@/lib/api/handler";
import type { RequestContext } from "@/lib/auth/context";
import { mfaStatus } from "@/lib/services/sec-mfa";
import { mfaRequiredFor } from "@/lib/services/sec-policy";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({}, async ({ ctx }) => ({ mfa: await mfaStatus(ctx.user.id), mfaRequired: await mfaRequiredFor(ctx.user.role, ctx.user.tenantId) }));
