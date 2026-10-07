import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireOrgAccess } from "@/lib/session";
import { idSchema, manualConnectSchema } from "@/lib/validations";
import { connectManual, getAccount } from "@/services/whatsapp";

type Ctx = { params: Promise<{ orgId: string }> };

/**
 * Developer setup. The access token / app secret are verified against Meta,
 * encrypted at rest and NEVER included in any response.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const orgId = idSchema.parse((await params).orgId);
  const access = await requireOrgAccess(orgId, "whatsapp:manage", req);
  enforceRateLimit(`wa-manual:${access.user.id}`, 10, 15 * 60_000);
  const input = await readJson(req, manualConnectSchema);
  const account = await connectManual({ organizationId: orgId, actorUserId: access.user.id, req }, { ...input, appSecret: input.appSecret || undefined });
  return ok({ account: await getAccount(orgId, account.id) }, { status: 201 });
});
