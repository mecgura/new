import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { pagesRoute } from "@/services/landing/route-guard";
import { setPublished } from "@/services/landing/pages";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

/** Publish the current draft, or take the page offline. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { ctx, ids } = await pagesRoute(req, params, "pages:manage");
  const { publish } = await readJson(req, z.object({ publish: z.boolean() }).strict());
  return ok({ page: await setPublished(ctx, ids.id, publish) });
});
