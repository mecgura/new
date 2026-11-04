import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { listMenu, menuItemSchema, saveMenuItem } from "@/services/food/food";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "food:kitchen");
  return ok({ items: await listMenu(access.organizationId) });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "food:manage");
  return ok({ item: await saveMenuItem(access, null, await readJson(req, menuItemSchema)) }, { status: 201 });
});
