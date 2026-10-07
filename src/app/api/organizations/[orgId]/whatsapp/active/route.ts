import { cookies } from "next/headers";
import { z } from "zod";
import { ApiError, handle, ok, readJson } from "@/lib/api";
import { audit } from "@/lib/audit";
import { ACTIVE_NUMBER_COOKIE, encodeActiveNumber } from "@/lib/active-number";
import { db } from "@/lib/db";
import { orgRoute } from "@/lib/route-helpers";

type Ctx = { params: Promise<{ orgId: string }> };

const schema = z.object({ accountId: z.string().max(64) }); // "" = all numbers

/** Switch the active number. Any member may do it; it only changes their own view and is validated against the workspace. */
export const PUT = handle<Ctx>(async (req, { params }) => {
  const { access } = await orgRoute(req, params, "inbox:read");
  const { accountId } = await readJson(req, schema);
  if (accountId) {
    const a = await db.whatsAppAccount.findFirst({ where: { id: accountId, organizationId: access.organizationId, status: { in: ["connected", "demo"] } }, select: { id: true } });
    if (!a) throw new ApiError("VALIDATION_ERROR", "Choose one of this workspace's connected numbers.", { details: { accountId: ["Unknown number"] } });
  }
  (await cookies()).set(ACTIVE_NUMBER_COOKIE, accountId ? encodeActiveNumber(access.organizationId, accountId) : "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: accountId ? 60 * 60 * 24 * 180 : 0,
  });
  await audit({ action: "whatsapp.active_number_changed", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "whatsapp_account", targetId: accountId, metadata: { all: !accountId }, req });
  return ok({ ok: true, accountId });
});
