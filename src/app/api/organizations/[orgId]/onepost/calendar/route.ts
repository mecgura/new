import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { listCalendar } from "@/services/onepost/delivery";

type Ctx = { params: Promise<{ orgId: string }> };
const query = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) });

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:read");
  const q = readQuery(req, query);
  const from = new Date(q.from);
  const to = new Date(q.to);
  // A calendar view is at most six weeks wide.
  if (to <= from || to.getTime() - from.getTime() > 46 * 86_400_000) return ok({ items: [], ready: [] });
  return ok(await listCalendar(access, { from, to }));
});
