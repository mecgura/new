import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { setNumberCalling } from "@/services/calls/whatsapp-calls";

type Ctx = { params: Promise<{ orgId: string; accountId: string }> };

/** Turns WhatsApp calling on or off for a connected number. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "whatsapp:manage");
  const { enabled } = await readJson(req, z.object({ enabled: z.boolean() }).strict());
  return ok(await setNumberCalling(access, ids.accountId, enabled));
});
