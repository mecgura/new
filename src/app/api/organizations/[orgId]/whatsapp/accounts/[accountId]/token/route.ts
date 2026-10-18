import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireOrgAccess } from "@/lib/session";
import { idSchema, replaceTokenSchema } from "@/lib/validations";
import { replaceAccessToken } from "@/services/whatsapp";

type Ctx = { params: Promise<{ orgId: string; accountId: string }> };

/** Replaces the stored Meta access token. The token is verified against Meta, encrypted, and never included in a response. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const p = await params;
  const orgId = idSchema.parse(p.orgId);
  const access = await requireOrgAccess(orgId, "whatsapp:manage", req);
  enforceRateLimit(`wa-token:${access.user.id}`, 10, 15 * 60_000);
  const input = await readJson(req, replaceTokenSchema);
  const account = await replaceAccessToken({ organizationId: orgId, actorUserId: access.user.id, req }, idSchema.parse(p.accountId), { ...input, appSecret: input.appSecret || undefined });
  return ok({ account });
});
