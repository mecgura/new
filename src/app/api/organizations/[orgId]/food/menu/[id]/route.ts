import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { deleteMenuItem, menuItemSchema, saveMenuItem } from "@/services/food/food";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "food:manage");
  return ok({ item: await saveMenuItem(access, ids.id, await readJson(req, menuItemSchema)) });
});

/** Kitchen staff can mark a dish sold out / back without editing the menu. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "food:kitchen");
  const { available } = await readJson(req, z.object({ available: z.boolean() }).strict());
  const r = await db.menuItem.updateMany({ where: { id: ids.id, organizationId: access.organizationId }, data: { available } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Menu item not found.");
  return ok({ available });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "food:manage");
  await deleteMenuItem(access, ids.id);
  return ok({ deleted: true });
});
