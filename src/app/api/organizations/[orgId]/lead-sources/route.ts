import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { leadSourceCreateSchema } from "@/lib/validations";
import { createLeadSource, listLeadSources } from "@/services/leads/leads";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "whatsapp:read");
  return ok({ sources: await listLeadSources(access.organizationId) });
});

/** Connect a Facebook Page's Lead Ad forms. The Page token is verified with Meta, stored encrypted and never returned. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "whatsapp:manage");
  enforceRateLimit(`lead-source:${access.user.id}`, 10, 15 * 60_000);
  const input = await readJson(req, leadSourceCreateSchema);
  return ok(await createLeadSource(access, input, req), { status: 201 });
});
