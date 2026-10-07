import { handle, ok, readJson } from "@/lib/api";
import { orgRoute } from "@/lib/route-helpers";
import { consentSchema } from "@/lib/validations";
import { recordConsent } from "@/services/inbox/contacts";

type Ctx = { params: Promise<{ orgId: string; id: string }> };

/** Records an opt-in / opt-out with evidence (append-only history). */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "contacts:write");
  const { status, evidence } = await readJson(req, consentSchema);
  await recordConsent({ organizationId: access.organizationId, actorUserId: access.user.id, req }, ids.id, { status, source: "manual", evidence });
  return ok({ ok: true });
});
