import { apiRoute } from "@/lib/api/handler";
import { clientIp, publicTenantId } from "@/lib/api/public";
import { AppError } from "@/lib/errors";
import { publicSlots } from "@/lib/services/appointments";
import { rateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
export const GET = apiRoute<null>({ auth: false }, async ({ req }) => {
  const tenantId = await publicTenantId(req);
  const lim = await rateLimit(`slots:${tenantId}:${clientIp(req) ?? "?"}`, { limit: 120, windowMs: 60_000 });
  if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const sp = new URL(req.url).searchParams;
  return publicSlots(tenantId, sp.get("doctor") ?? "", sp.get("date") ?? "");
});
