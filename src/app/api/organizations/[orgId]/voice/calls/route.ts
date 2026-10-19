import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { orgRoute } from "@/lib/route-helpers";
import { voiceCallSchema } from "@/lib/validations";
import { createCall, listCalls } from "@/services/voice/calls";

type Ctx = { params: Promise<{ orgId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "voice:read");
  return ok(await listCalls(access.organizationId));
});

/** Place an AI call. Without a connected voice provider this records a labelled practice call; nobody is phoned. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "voice:manage");
  enforceRateLimit(`voice:${access.user.id}`, 30, 60 * 60_000);
  const input = await readJson(req, voiceCallSchema);
  return ok({ call: await createCall(access, input, req) }, { status: 201 });
});
