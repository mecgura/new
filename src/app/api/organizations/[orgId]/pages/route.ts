import { handle, ok, readJson } from "@/lib/api";
import { STARTERS } from "@/lib/landing";
import { pagesRoute } from "@/services/landing/route-guard";
import { createPage, createSchema, listPages } from "@/services/landing/pages";

type Ctx = { params: Promise<{ orgId: string }> };

/** Pages with 30-day views, leads and conversion, plus the industry starter templates. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await pagesRoute(req, params, "pages:read");
  return ok({ pages: await listPages(ctx.organizationId), starters: STARTERS.map(({ id, name, description, title }) => ({ id, name, description, title })) });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { ctx } = await pagesRoute(req, params, "pages:manage");
  return ok({ page: await createPage(ctx, await readJson(req, createSchema)) }, { status: 201 });
});
