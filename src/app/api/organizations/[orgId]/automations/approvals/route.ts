import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { listApprovals } from "@/services/automations/approvals";

type Ctx = { params: Promise<{ orgId: string }> };
const query = z.object({ status: z.enum(["pending", "decided"]).default("pending") });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "automations:read");
  return ok({ approvals: await listApprovals(access, readQuery(req, query).status) });
});
