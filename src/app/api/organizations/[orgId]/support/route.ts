import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSchema, createTicket, listOrgTickets } from "@/services/support/tickets";

type Ctx = { params: Promise<{ orgId: string }> };
export const maxDuration = 30;

/** This workspace's support tickets with MECGURA. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "support:use");
  return ok({ tickets: await listOrgTickets(access.organizationId) });
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "support:use");
  enforceRateLimit(`ticket-create:${access.user.id}`, 10, 3_600_000);
  return ok({ ticket: await createTicket(access.organizationId, { userId: access.user.id, req }, await readJson(req, createSchema)) }, { status: 201 });
});
