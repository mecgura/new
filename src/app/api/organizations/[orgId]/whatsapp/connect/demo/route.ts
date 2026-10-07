import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireOrgAccess } from "@/lib/session";
import { demoConnectSchema, idSchema } from "@/lib/validations";
import { connectDemo, getAccount } from "@/services/whatsapp";

type Ctx = { params: Promise<{ orgId: string }> };

/** Demo connection — fictional data, status "demo", never talks to Meta. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const orgId = idSchema.parse((await params).orgId);
  const access = await requireOrgAccess(orgId, "whatsapp:manage", req);
  enforceRateLimit(`wa-demo:${access.user.id}`, 20, 15 * 60_000);
  const input = await readJson(req, demoConnectSchema);
  const account = await connectDemo({ organizationId: orgId, actorUserId: access.user.id, req }, input);
  return ok({ account: await getAccount(orgId, account.id) }, { status: 201 });
});
