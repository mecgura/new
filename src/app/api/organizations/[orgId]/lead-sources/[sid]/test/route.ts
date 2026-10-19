import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { testLeadSchema } from "@/lib/validations";
import { sendTestLead } from "@/services/leads/leads";

type Ctx = { params: Promise<{ orgId: string; sid: string }> };

/** Runs a made-up lead through the real pipeline (contact, consent, reply). It really messages the phone number you give. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access, ids } = await orgRoute(req, params, "whatsapp:manage");
  enforceRateLimit(`lead-test:${access.user.id}`, 10, 15 * 60_000);
  const input = await readJson(req, testLeadSchema);
  return ok({ result: await sendTestLead(access, ids.sid, input) });
});
