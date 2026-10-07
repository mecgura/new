import { cookies } from "next/headers";
import { ApiError, handle, ok, readJson } from "@/lib/api";
import { ACTIVE_ORG_COOKIE, requireUser } from "@/lib/session";
import { activeOrganizationSchema } from "@/lib/validations";

/** Switch workspace. The requested org is validated against the user's DB memberships. */
export const POST = handle(async (req) => {
  const user = await requireUser();
  const { organizationId } = await readJson(req, activeOrganizationSchema);
  const membership = user.memberships.find((m) => m.organizationId === organizationId && m.organizationStatus === "active");
  if (!membership) throw new ApiError("FORBIDDEN");
  (await cookies()).set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return ok({ ok: true, activeOrganizationId: organizationId });
});
