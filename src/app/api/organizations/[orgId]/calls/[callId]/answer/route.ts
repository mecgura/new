import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { answer } from "@/services/calls/whatsapp-calls";

type Ctx = { params: Promise<{ orgId: string; callId: string }> };

/** Answers a ringing customer call with the browser's WebRTC answer. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "inbox:reply");
  const { sdp } = await readJson(req, z.object({ sdp: z.string().min(20).max(20_000).startsWith("v=0") }).strict());
  return ok({ call: await answer(access, ids.callId, sdp) });
});
