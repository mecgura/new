import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { deleteConnection, storeSettingsSchema, updateConnection } from "@/services/integrations/stores";

type Ctx = { params: Promise<{ orgId: string; iid: string }> };
const schema = z.object({ name: z.string().trim().min(1).max(80).optional(), status: z.enum(["active", "disabled"]).optional(), settings: storeSettingsSchema.partial().optional() });

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "webhooks:manage");
  return ok({ connection: await updateConnection(access, ids.iid, await readJson(req, schema)) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "webhooks:manage");
  await deleteConnection(access, ids.iid, req);
  return ok({ ok: true });
});
