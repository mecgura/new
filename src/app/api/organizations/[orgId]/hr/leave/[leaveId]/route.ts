import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { decideLeave, decideSchema } from "@/services/hr/hrms";

type Ctx = { params: Promise<{ orgId: string; leaveId: string }> };

/** Approve (marks the days as leave) or reject. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "hr:manage");
  const { status } = await readJson(req, decideSchema);
  return ok({ leave: await decideLeave(access, ids.leaveId, status, req) });
});
