import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { addLeave, leaveSchema, listLeave } from "@/services/hr/hrms";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "hr:manage");
  return ok({ leave: await listLeave(access) });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "hr:manage");
  return ok({ leave: await addLeave(access, await readJson(req, leaveSchema), req) }, { status: 201 });
});
