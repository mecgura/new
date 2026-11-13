import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { deleteDue, setDuePaid } from "@/services/dues/dues";

type Ctx = { params: Promise<{ orgId: string; did: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "campaigns:manage");
  const { paid } = await readJson(req, z.object({ paid: z.boolean() }));
  return ok(await setDuePaid(access, ids.did, paid));
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "campaigns:manage");
  await deleteDue(access, ids.did);
  return ok({ deleted: true });
});
