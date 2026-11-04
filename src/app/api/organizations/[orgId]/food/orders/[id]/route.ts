import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { advanceOrder } from "@/services/food/food";

type Ctx = { params: Promise<{ orgId: string; id: string }> };
const schema = z.object({ to: z.enum(["accepted", "preparing", "ready", "delivered", "cancelled"]), reason: z.string().trim().max(200).default("") }).strict();

/** Moves the order one step; the guest gets a WhatsApp update. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "food:kitchen");
  const { to, reason } = await readJson(req, schema);
  return ok(await advanceOrder(access, ids.id, to, reason, req));
});
