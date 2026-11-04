import { handle, ok } from "@/lib/api";
import { pagesRoute } from "@/services/landing/route-guard";
import { duplicatePage } from "@/services/landing/pages";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const { ctx, ids } = await pagesRoute(req, params, "pages:manage");
  return ok({ page: await duplicatePage(ctx, ids.id) }, { status: 201 });
});
