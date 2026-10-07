import { handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { refreshNumberHealth } from "@/services/quality/quality";

type Ctx = { params: Promise<{ orgId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "whatsapp:manage");
  enforceRateLimit(`quality-refresh:${access.organizationId}`, 10, 10 * 60_000);
  return ok(await refreshNumberHealth(access, req));
});
