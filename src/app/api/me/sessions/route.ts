import { handle, ok } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { revokeAllSessions } from "@/lib/services/accounts";

/** "Sign out of all devices": invalidates every existing session, including this one. */
export const DELETE = handle(async (req) => {
  const user = await requireUser();
  await revokeAllSessions(user.id, req);
  return ok({ ok: true });
});
