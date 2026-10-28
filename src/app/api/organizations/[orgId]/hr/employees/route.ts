import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { employeeSchema, listEmployees, saveEmployee } from "@/services/hr/hrms";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "hr:manage");
  return ok({ employees: await listEmployees(access) });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "hr:manage");
  return ok({ employee: await saveEmployee(access, null, await readJson(req, employeeSchema), req) }, { status: 201 });
});
