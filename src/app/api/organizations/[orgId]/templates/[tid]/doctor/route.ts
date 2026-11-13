import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { doctorTemplate, fixTemplate } from "@/services/templates/templates";

type Ctx = { params: Promise<{ orgId: string; tid: string }> };

/** Why Meta rejected this template, in plain words. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "templates:read");
  return ok(await doctorTemplate(access, ids.tid));
});

/** Creates a fixed draft copy under a new name. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "templates:manage");
  return ok(await fixTemplate(access, ids.tid, req), { status: 201 });
});
