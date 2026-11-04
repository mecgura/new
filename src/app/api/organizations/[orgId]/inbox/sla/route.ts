import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { getInboxSla, inboxSlaSchema, saveInboxSla } from "@/services/inbox/sla";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:read");
  return ok({ sla: await getInboxSla(access.organizationId) });
});

/** First-reply target, escalation and the CSAT question (owners and managers). */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:assign");
  return ok({ sla: await saveInboxSla(access, await readJson(req, inboxSlaSchema), req) });
});
