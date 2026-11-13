import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { remindSchema, sendDueReminders } from "@/services/dues/dues";

type Ctx = { params: Promise<{ orgId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "campaigns:manage");
  enforceRateLimit(`dues-remind:${access.user.id}`, 6, 60 * 60_000);
  return ok(await sendDueReminders(access, await readJson(req, remindSchema), req));
});
