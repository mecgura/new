import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { quickAutomationSchema } from "@/lib/validations";
import { createQuickAutomation } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string }> };

/** Easy setup: one form → a complete, published automation. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "automations:manage");
  const input = await readJson(req, quickAutomationSchema);
  return ok(await createQuickAutomation(access, input, req), { status: 201 });
});
