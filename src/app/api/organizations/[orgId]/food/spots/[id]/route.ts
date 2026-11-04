import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { deleteSpot, updateSpot } from "@/services/food/food";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "food:manage");
  await updateSpot(access, ids.id, await readJson(req, z.object({ active: z.boolean().optional(), label: z.string().trim().min(1).max(60).optional() }).strict()));
  return ok({ updated: true });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "food:manage");
  await deleteSpot(access, ids.id);
  return ok({ deleted: true });
});
