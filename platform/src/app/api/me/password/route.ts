import { handle, ok, readJson } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { accountPasswordSchema } from "@/lib/validations";
import { changePassword } from "@/lib/services/accounts";

export const POST = handle(async (req) => {
  const user = await requireUser();
  enforceRateLimit(`password:${user.id}`, 5, 15 * 60_000);
  const { currentPassword, newPassword } = await readJson(req, accountPasswordSchema);
  await changePassword(user.id, currentPassword, newPassword, req);
  return ok({ ok: true, message: "Password changed. Other sessions have been signed out — please sign in again." });
});
