import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { templateUpdateSchema } from "@/lib/validations";
import { deleteTemplate, getTemplate, updateTemplate } from "@/services/templates/templates";

type Ctx = { params: Promise<{ orgId: string; tid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "templates:read");
  return ok({ template: await getTemplate(access, ids.tid) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "templates:manage");
  const input = await readJson(req, templateUpdateSchema);
  return ok({ template: await updateTemplate(access, ids.tid, input, req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "templates:manage");
  await deleteTemplate(access, ids.tid, req);
  return ok({ ok: true });
});
