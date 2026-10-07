import { ApiError, handle, ok, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema, whatsappAccountSchema } from "@/lib/validations";
import { assertWithinLimit } from "@/lib/services/usage";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  return ok({ accounts: await db.whatsAppAccount.findMany({ where: { organizationId: id }, orderBy: { createdAt: "asc" } }) });
});

/** Registers a number for a client. It stays "pending" until the WhatsApp integration connects it. */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const input = await readJson(req, whatsappAccountSchema);
  if (!(await db.organization.count({ where: { id } }))) throw new ApiError("NOT_FOUND", "Client not found.");
  if (await db.whatsAppAccount.findUnique({ where: { phoneNumber: input.phoneNumber } })) {
    throw new ApiError("CONFLICT", "This number is already registered to a client.", { details: { phoneNumber: ["Already registered"] } });
  }
  await assertWithinLimit(id, "whatsapp_numbers");
  const account = await db.whatsAppAccount.create({ data: { organizationId: id, ...input } });
  await audit({ action: "whatsapp.account_added", actorUserId: admin.id, organizationId: id, targetType: "whatsapp_account", targetId: account.id, metadata: { phoneNumber: account.phoneNumber }, req });
  return ok({ account }, { status: 201 });
});
