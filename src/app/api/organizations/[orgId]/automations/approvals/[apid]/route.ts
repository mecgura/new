import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { decideApproval } from "@/services/automations/approvals";

type Ctx = { params: Promise<{ orgId: string; apid: string }> };
const schema = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(500).default("") });

/** Owners, managers or the named approver decide; the waiting run continues on that branch. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "automations:read");
  const { decision, note } = await readJson(req, schema);
  return ok({ approval: await decideApproval(access, ids.apid, decision, note, req) });
});
