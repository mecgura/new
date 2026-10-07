import { ApiError, handle, ok, readJson } from "@/lib/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireSuperAdmin } from "@/lib/session";
import { adminUserUpdateSchema, idSchema } from "@/lib/validations";
import { deleteUser } from "@/lib/services/clients";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const input = await readJson(req, adminUserUpdateSchema);
  if (id === admin.id && input.status === "disabled") {
    throw new ApiError("CONFLICT", "You can't disable your own account.");
  }
  const before = await db.user.findUnique({ where: { id }, select: { status: true } });
  if (!before) throw new ApiError("NOT_FOUND", "User not found.");
  const user = await db.user.update({
    where: { id },
    // Disabling also bumps the session version so existing sessions die immediately.
    data: { ...input, ...(input.status === "disabled" && before.status !== "disabled" ? { sessionVersion: { increment: 1 } } : {}) },
    select: { id: true, name: true, email: true, status: true, role: true },
  });
  await audit({ action: "user.updated", actorUserId: admin.id, targetType: "user", targetId: id, metadata: { changes: input, by: "super_admin" }, req });
  return ok({ user });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  await deleteUser(admin.id, id, req);
  return ok({ ok: true });
});
