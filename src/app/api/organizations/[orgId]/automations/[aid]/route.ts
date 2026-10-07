import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { automationUpdateSchema } from "@/lib/validations";
import type { Graph } from "@/lib/automations";
import { deleteAutomation, getAutomation, updateAutomation } from "@/services/automations/automations";

type Ctx = { params: Promise<{ orgId: string; aid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:read");
  return ok({ automation: await getAutomation(access, ids.aid) });
});

/** Saves the draft (the live published version is unaffected until the next publish). */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:manage");
  const input = await readJson(req, automationUpdateSchema);
  return ok({ automation: await updateAutomation(access, ids.aid, { ...input, graph: input.graph as Graph | undefined }, req) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:manage");
  await deleteAutomation(access, ids.aid, req);
  return ok({ ok: true });
});
