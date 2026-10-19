import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { channelCreateSchema } from "@/lib/validations";
import { createChannel, listChannels } from "@/services/channels/accounts";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:read");
  return ok(await listChannels(access.organizationId));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "channels:manage");
  enforceRateLimit(`channel-create:${access.user.id}`, 10, 15 * 60_000);
  const input = await readJson(req, channelCreateSchema);
  return ok({ channel: await createChannel(access, input, req) }, { status: 201 });
});
