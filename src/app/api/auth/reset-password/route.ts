import { handle, ok, readJson, clientIp } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { resetPasswordSchema } from "@/lib/validations";
import { resetPassword } from "@/lib/services/accounts";

export const POST = handle(async (req) => {
  enforceRateLimit(`reset:${clientIp(req)}`, 10, 15 * 60_000);
  const { token, password } = await readJson(req, resetPasswordSchema);
  await resetPassword(token, password, req);
  return ok({ ok: true, message: "Password updated. You can now sign in." });
});
