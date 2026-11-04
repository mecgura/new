import { handle, ok, readJson } from "@/lib/api";
import { pagesRoute } from "@/services/landing/route-guard";
import { deletePage, getPage, savePage, saveSchema } from "@/services/landing/pages";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx, ids } = await pagesRoute(req, params, "pages:read");
  return ok({ page: await getPage(ctx.organizationId, ids.id) });
});

/** Saves the draft (visitors keep seeing the published version until you publish again). */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const { ctx, ids } = await pagesRoute(req, params, "pages:manage");
  return ok({ page: await savePage(ctx, ids.id, await readJson(req, saveSchema)) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { ctx, ids } = await pagesRoute(req, params, "pages:manage");
  await deletePage(ctx, ids.id);
  return ok({ ok: true });
});
