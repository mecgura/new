import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { deleteEmployee, employeeSchema, saveEmployee } from "@/services/hr/hrms";

type Ctx = { params: Promise<{ orgId: string; employeeId: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "hr:manage");
  return ok({ employee: await saveEmployee(access, ids.employeeId, await readJson(req, employeeSchema), req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "hr:manage");
  await deleteEmployee(access, ids.employeeId, req);
  return ok({ deleted: true });
});
