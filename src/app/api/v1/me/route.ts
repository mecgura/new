import { apiHandle } from "@/lib/api-auth";
import { API_KEY_LIMITS } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { ok } from "@/lib/api";

/** Who is this key? Works with any valid key — handy for checking a deployment. */
export const GET = apiHandle(null, async (_req, _ctx, p) => {
  const org = await db.organization.findUniqueOrThrow({ where: { id: p.organizationId }, select: { id: true, name: true } });
  return ok({ data: { organization: org, key: { id: p.keyId, name: p.keyName, permissions: p.scopes }, rate_limit: { per_minute: API_KEY_LIMITS.perMinute } } });
});
