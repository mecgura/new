import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireOrgAccess } from "@/lib/session";
import { embeddedCompleteSchema, idSchema } from "@/lib/validations";
import { completeEmbeddedSignup, getAccount } from "@/services/whatsapp";

type Ctx = { params: Promise<{ orgId: string }> };

/** Receives the code + ids from Meta's Embedded Signup popup; token exchange happens server-side only. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const orgId = idSchema.parse((await params).orgId);
  const access = await requireOrgAccess(orgId, "whatsapp:manage", req);
  enforceRateLimit(`wa-complete:${access.user.id}`, 10, 15 * 60_000);
  const input = await readJson(req, embeddedCompleteSchema);
  const account = await completeEmbeddedSignup({ organizationId: orgId, actorUserId: access.user.id, req }, input);
  return ok({ account: await getAccount(orgId, account.id) }, { status: 201 });
});
