import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { importContacts, importSchema } from "@/services/onepost/pr";

type Ctx = { params: Promise<{ orgId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:publish");
  enforceRateLimit(`onepost-import:${access.user.id}`, 10, 15 * 60_000);
  return ok(await importContacts(access, (await readJson(req, importSchema)).csv, req));
});
