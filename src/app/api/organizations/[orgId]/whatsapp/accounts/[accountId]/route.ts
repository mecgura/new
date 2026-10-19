import { handle, ok, readJson } from "@/lib/api";
import { requireOrgAccess } from "@/lib/session";
import { idSchema, whatsappSettingsSchema } from "@/lib/validations";
import { deleteAccount, getAccount, updateAccountSettings } from "@/services/whatsapp";

type Ctx = { params: Promise<{ orgId: string; accountId: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const p = await params;
  const orgId = idSchema.parse(p.orgId);
  await requireOrgAccess(orgId, "whatsapp:read", req);
  return ok({ account: await getAccount(orgId, idSchema.parse(p.accountId)) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const p = await params;
  const orgId = idSchema.parse(p.orgId);
  const access = await requireOrgAccess(orgId, "whatsapp:manage", req);
  const input = await readJson(req, whatsappSettingsSchema);
  return ok({ account: await updateAccountSettings({ organizationId: orgId, actorUserId: access.user.id, req }, idSchema.parse(p.accountId), input) });
});

/** Removes a number that is not live (demo, unfinished or disconnected). Live numbers must be disconnected first. */
export const DELETE = handle<Ctx>(async (req, { params }) => {
  const p = await params;
  const orgId = idSchema.parse(p.orgId);
  const access = await requireOrgAccess(orgId, "whatsapp:manage", req);
  await deleteAccount({ organizationId: orgId, actorUserId: access.user.id, req }, idSchema.parse(p.accountId));
  return ok({ deleted: true });
});
