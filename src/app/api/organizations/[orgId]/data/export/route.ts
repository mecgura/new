import { handle } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { exportWorkspace } from "@/services/account/data";

export const maxDuration = 60;
type Ctx = { params: Promise<{ orgId: string }> };

/** Full workspace export as JSON (owner only; secrets never included). */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "org:update");
  enforceRateLimit(`ws-export:${access.organizationId}`, 5, 60 * 60_000);
  const { filename, body } = await exportWorkspace(access, req);
  return new Response(body, { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
});
