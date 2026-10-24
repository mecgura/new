import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { idSchema } from "@/lib/validations";
import { liveCalls, startOutbound } from "@/services/calls/whatsapp-calls";

type Ctx = { params: Promise<{ orgId: string }> };
const sdpSchema = z.string().min(20).max(20_000).startsWith("v=0");

/** WhatsApp calls ringing or in progress (the browser polls this to ring and to show the call bar). */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:read");
  return ok({ calls: await liveCalls(access) });
});

/** Calls the customer of a WhatsApp chat (body: the browser's WebRTC offer). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:reply");
  enforceRateLimit(`wa-call:${access.user.id}`, 30, 60 * 60_000);
  const input = await readJson(req, z.object({ conversationId: idSchema, sdp: sdpSchema }).strict());
  return ok({ call: await startOutbound(access, input.conversationId, input.sdp) }, { status: 201 });
});
