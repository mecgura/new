import { z } from "zod";
import { handle, ok, readQuery } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { campaignAnalytics } from "@/services/campaigns/campaigns";

type Ctx = { params: Promise<{ orgId: string; cid: string }> };

const query = z.object({
  status: z.enum(["", "queued", "sending", "sent", "delivered", "read", "failed", "skipped", "replied", "opted_out"]).optional().default(""),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "campaigns:read");
  const q = readQuery(req, query);
  return ok(await campaignAnalytics(access, ids.cid, { status: q.status || undefined, page: q.page }));
});
