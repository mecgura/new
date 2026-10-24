import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { idSchema } from "@/lib/validations";
import { requestPermission } from "@/services/calls/whatsapp-calls";

type Ctx = { params: Promise<{ orgId: string }> };

/** Sends WhatsApp's "may we call you?" request in a chat. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:reply");
  enforceRateLimit(`wa-call-perm:${access.user.id}`, 30, 60 * 60_000);
  const { conversationId } = await readJson(req, z.object({ conversationId: idSchema }).strict());
  return ok(await requestPermission(access, conversationId));
});
