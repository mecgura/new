import { ApiError, handle, ok } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { startOAuth } from "@/services/onepost/connections";

type Ctx = { params: Promise<{ orgId: string; provider: string }> };

/** Begins a LinkedIn or Google sign-in. Returns the provider's address to send the person to. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const raw = await params;
  const { access } = await orgRoute(req, Promise.resolve({ orgId: raw.orgId }), "onepost:connect");
  if (raw.provider !== "linkedin" && raw.provider !== "gbp") throw new ApiError("NOT_FOUND", "Unknown provider.");
  enforceRateLimit(`onepost-oauth:${access.user.id}`, 20, 15 * 60_000);
  return ok(await startOAuth(access, raw.provider));
});
