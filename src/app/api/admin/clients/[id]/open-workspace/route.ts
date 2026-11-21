import { cookies } from "next/headers";
import { ApiError, handle, ok } from "@/lib/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ACTIVE_ORG_COOKIE, requireSuperAdmin } from "@/lib/session";
import { idSchema } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Super Admin "support access": step into a client's workspace to set things up
 * for them (e.g. connect their WhatsApp number). Only the platform operator can
 * do this, it is audited, and it is shown as a banner on every page.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireSuperAdmin(req);
  const id = idSchema.parse((await params).id);
  const org = await db.organization.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!org) throw new ApiError("NOT_FOUND", "Client not found.");
  (await cookies()).set(ACTIVE_ORG_COOKIE, org.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8, // support access expires on its own
  });
  await audit({ action: "admin.workspace_opened", actorUserId: admin.id, organizationId: org.id, targetType: "organization", targetId: org.id, metadata: { name: org.name }, req });
  return ok({ ok: true, organizationId: org.id });
});
