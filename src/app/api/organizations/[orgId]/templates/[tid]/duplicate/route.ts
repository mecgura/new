import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { templateDuplicateSchema } from "@/lib/validations";
import { duplicateTemplate } from "@/services/templates/templates";

type Ctx = { params: Promise<{ orgId: string; tid: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "templates:manage");
  const { name } = await readJson(req, templateDuplicateSchema);
  return ok({ template: await duplicateTemplate(access, ids.tid, name, req) }, { status: 201 });
});
