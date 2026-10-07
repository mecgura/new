import { cookies } from "next/headers";
import { handle, ok } from "@/lib/api";
import { ACTIVE_ORG_COOKIE, requireUser, resolveActiveMembership } from "@/lib/session";

export const GET = handle(async () => {
  const user = await requireUser();
  const active = resolveActiveMembership(user, (await cookies()).get(ACTIVE_ORG_COOKIE)?.value);
  return ok({ user, activeOrganizationId: active?.organizationId ?? null });
});
