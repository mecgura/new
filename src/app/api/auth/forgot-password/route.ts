import { handle, ok, readJson, clientIp } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { forgotPasswordSchema } from "@/lib/validations";
import { requestPasswordReset } from "@/lib/services/accounts";

export const POST = handle(async (req) => {
  enforceRateLimit(`forgot:${clientIp(req)}`, 5, 15 * 60_000);
  const { email } = await readJson(req, forgotPasswordSchema);
  enforceRateLimit(`forgot-email:${email}`, 3, 15 * 60_000);
  await requestPasswordReset(email, req);
  // Same response whether or not the account exists (no account enumeration).
  return ok({ ok: true, message: "If an account exists for that email, a reset link has been sent." });
});
