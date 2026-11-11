import { apiRoute } from "@/lib/api/handler";
import { clientIp, publicTenantId } from "@/lib/api/public";
import { AppError } from "@/lib/errors";
import { tokenStatus } from "@/lib/services/opd";
import { rateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const GET = apiRoute<null>({ auth: false }, async ({ req, params }) => {
  const tenantId = await publicTenantId(req);
  const lim = await rateLimit(`token:${tenantId}:${clientIp(req) ?? "?"}`, { limit: 60, windowMs: 60_000 });
  if (!lim.allowed) throw new AppError("RATE_LIMITED");
  return tokenStatus(tenantId, params.token);
});
