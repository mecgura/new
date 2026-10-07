import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { automationTestSchema } from "@/lib/validations";
import { testAutomation } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

export const maxDuration = 60;

/** Runs the current draft against one contact (delays can be skipped). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:manage");
  enforceRateLimit(`auto-test:${access.user.id}`, 30, 60 * 60_000);
  const input = await readJson(req, automationTestSchema);
  return ok(await testAutomation(access, ids.aid, input, req), { status: 201 });
});
