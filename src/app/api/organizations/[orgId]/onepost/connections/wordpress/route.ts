import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { connectWordPress, wordpressSchema } from "@/services/onepost/connections";

type Ctx = { params: Promise<{ orgId: string }> };

/** Connects a self-hosted WordPress site with a WordPress Application Password. The password is verified, then stored encrypted and never shown again. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "onepost:connect");
  enforceRateLimit(`onepost-wp:${access.user.id}`, 10, 15 * 60_000);
  return ok({ connection: await connectWordPress(access, await readJson(req, wordpressSchema), req) }, { status: 201 });
});
