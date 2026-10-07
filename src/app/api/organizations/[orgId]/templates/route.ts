import { handle, ok, readJson, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { templateCreateSchema, templateListSchema } from "@/lib/validations";
import { createTemplate, listTemplateAccounts, listTemplates } from "@/services/templates/templates";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "templates:read");
  const q = readQuery(req, templateListSchema);
  const [data, accounts] = await Promise.all([
    listTemplates(access, { status: q.status || undefined, category: q.category || undefined, q: q.q || undefined, wabaId: q.wabaId || undefined }),
    listTemplateAccounts(access.organizationId),
  ]);
  return ok({ ...data, accounts });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "templates:manage");
  const input = await readJson(req, templateCreateSchema);
  return ok({ template: await createTemplate(access, input, req) }, { status: 201 });
});
