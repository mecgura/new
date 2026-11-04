import { handle, ok } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { foodReport } from "@/services/food/food";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "food:manage");
  const d = Number(new URL(req.url).searchParams.get("days") ?? 7);
  return ok(await foodReport(access.organizationId, [1, 7, 30].includes(d) ? d : 7));
});
