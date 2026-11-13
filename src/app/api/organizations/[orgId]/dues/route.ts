import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { importDues, importSchema, listDues } from "@/services/dues/dues";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "campaigns:read");
  return ok(await listDues(access.organizationId));
});

/** Upload unpaid bills (CSV text from Tally / Excel). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "campaigns:manage");
  enforceRateLimit(`dues-import:${access.user.id}`, 10, 15 * 60_000);
  return ok(await importDues(access, await readJson(req, importSchema), req), { status: 201 });
});
