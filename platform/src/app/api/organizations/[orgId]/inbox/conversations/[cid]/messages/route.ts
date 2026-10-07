import { handle, ok, readJson, readQuery } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { messagesQuerySchema, sendMessageSchema } from "@/lib/validations";
import { listMessages } from "@/services/inbox/conversations";
import { sendMessage, type SendInput } from "@/services/inbox/messaging";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:read");
  const q = readQuery(req, messagesQuerySchema);
  return ok(await listMessages(access, ids.cid, q));
});

/** Send text, template, buttons or media-by-link. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:reply");
  enforceRateLimit(`send:${access.user.id}`, 60, 60_000);
  const input = (await readJson(req, sendMessageSchema)) as SendInput;
  return ok({ message: await sendMessage(access, ids.cid, input) }, { status: 201 });
});
