import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { channelUpdateSchema } from "@/lib/validations";
import { deleteChannel, updateChannel } from "@/services/channels/accounts";

type Ctx = { params: Promise<{ orgId: string; chid: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "channels:manage");
  const input = await readJson(req, channelUpdateSchema);
  return ok({ channel: await updateChannel(access, ids.chid, input) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "channels:manage");
  await deleteChannel(access, ids.chid, req);
  return ok({ deleted: true });
});
