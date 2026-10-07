import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { templateSyncSchema } from "@/lib/validations";
import { syncTemplates } from "@/services/templates/templates";

type Ctx = { params: Promise<{ orgId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "templates:manage");
  enforceRateLimit(`tpl-sync:${access.organizationId}`, 10, 10 * 60_000);
  const { wabaId } = await readJson(req, templateSyncSchema);
  return ok(await syncTemplates(access, wabaId, req));
});
