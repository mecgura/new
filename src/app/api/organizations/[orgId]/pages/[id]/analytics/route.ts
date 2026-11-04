import { handle, ok } from "@/lib/api";
import { pagesRoute } from "@/services/landing/route-guard";
import { pageAnalytics } from "@/services/landing/pages";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

/** Last 30 days: views, visitors, leads, conversion, clicks, sources (UTM / referrer) and the latest form entries. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx, ids } = await pagesRoute(req, params, "pages:read");
  return ok(await pageAnalytics(ctx.organizationId, ids.id));
});
