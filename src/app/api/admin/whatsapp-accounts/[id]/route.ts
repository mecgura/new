import { ApiError, handle, ok, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { idSchema, whatsappAccountUpdateSchema } from "@/lib/validations";
import { assertWithinLimit } from "@/lib/services/usage";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const input = await readJson(req, whatsappAccountUpdateSchema);
  const before = await db.whatsAppAccount.findUnique({ where: { id } });
  if (!before) throw new ApiError("NOT_FOUND", "WhatsApp number not found.");
  if (input.status && (before.status === "connected" || before.status === "demo")) {
    throw new ApiError("CONFLICT", "This number is connected. It must be disconnected from the client's Connection Center first.");
  }
  if (input.status === "pending" && before.status === "disabled") await assertWithinLimit(before.organizationId, "whatsapp_numbers");
  const account = await db.whatsAppAccount.update({ where: { id }, data: input });
  await audit({ action: "whatsapp.account_updated", actorUserId: admin.id, organizationId: before.organizationId, targetType: "whatsapp_account", targetId: id, metadata: { changes: input }, req });
  return ok({ account });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const before = await db.whatsAppAccount.findUnique({ where: { id } });
  if (!before) throw new ApiError("NOT_FOUND", "WhatsApp number not found.");
  if (before.status === "connected" || before.status === "demo") {
    throw new ApiError("CONFLICT", "This number is connected. It must be disconnected from the client's Connection Center first.");
  }
  await db.whatsAppAccount.delete({ where: { id } });
  await audit({ action: "whatsapp.account_removed", actorUserId: admin.id, organizationId: before.organizationId, targetType: "whatsapp_account", targetId: id, metadata: { phoneNumber: before.phoneNumber }, req });
  return ok({ ok: true });
});
