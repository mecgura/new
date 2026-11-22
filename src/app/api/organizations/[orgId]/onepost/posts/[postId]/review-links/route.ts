import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { createReviewLink, listReviewLinks, reviewLinkSchema } from "@/services/onepost/review-link";

type Ctx = { params: Promise<{ orgId: string; postId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:publish");
  return ok(await listReviewLinks(access, ids.postId));
});

/** Makes a private review link for a client. The address is returned once and never stored. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "onepost:publish");
  enforceRateLimit(`onepost-link:${access.user.id}`, 20, 15 * 60_000);
  return ok({ link: await createReviewLink(access, ids.postId, (await readJson(req, reviewLinkSchema)).days, req) }, { status: 201 });
});
