import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { listLeads } from "@/services/leads/leads";

type Ctx = { params: Promise<{ orgId: string; sid: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "whatsapp:read");
  return ok({ leads: await listLeads(access.organizationId, ids.sid) });
});
