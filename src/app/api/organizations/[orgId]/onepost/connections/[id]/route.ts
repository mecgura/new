import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { connectionSettingsSchema, disconnect, updateConnectionSettings } from "@/services/onepost/connections";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:connect");
  return ok({ connection: await updateConnectionSettings(access, ids.id, await readJson(req, connectionSettingsSchema)) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:connect");
  await disconnect(access, ids.id, req);
  return ok({ ok: true });
});
