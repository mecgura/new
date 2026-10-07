import { handle, ok } from "@/lib/api";
import { requireOrgAccess } from "@/lib/session";
import { idSchema } from "@/lib/validations";
import { getWebhookInfo } from "@/services/whatsapp";

type Ctx = { params: Promise<{ orgId: string; accountId: string }> };

/** Owners only: includes the developer-mode verify token (not a credential, but still restricted). */
export const GET = handle<Ctx>(async (req, { params }) => {
  const p = await params;
  const orgId = idSchema.parse(p.orgId);
  await requireOrgAccess(orgId, "whatsapp:manage", req);
  return ok({ webhook: await getWebhookInfo(orgId, idSchema.parse(p.accountId)) });
});
