import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import { clientReply, getTicket, replySchema } from "@/services/support/tickets";

type Ctx = { params: Promise<{ orgId: string; id: string }> };
export const maxDuration = 30;

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "support:use");
  return ok({ ticket: await getTicket(access.organizationId, ids.id) });
});

/** Reply to MECGURA on this ticket (reopens it if it was waiting or resolved). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "support:use");
  enforceRateLimit(`ticket-reply:${access.user.id}`, 60, 3_600_000);
  return ok({ ticket: await clientReply(access.organizationId, { userId: access.user.id, req }, ids.id, await readJson(req, replySchema)) });
});
