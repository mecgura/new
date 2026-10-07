import { handle, ok, readJson, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { automationCreateSchema, automationListSchema } from "@/lib/validations";
import { createAutomation, listAutomations } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "automations:read");
  const q = readQuery(req, automationListSchema);
  return ok(await listAutomations(access, { status: q.status || undefined, q: q.q || undefined }));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "automations:manage");
  const input = await readJson(req, automationCreateSchema);
  return ok({ automation: await createAutomation(access, input, req) }, { status: 201 });
});
