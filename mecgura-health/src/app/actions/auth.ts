"use server";
import { AuthError } from "next-auth";
import { signIn, signOut } from "@/auth";
import { getContext } from "@/lib/auth/context";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { ERROR_CODES, zodFieldErrors, type ApiFailure } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { getRequestMeta } from "@/lib/security/request";
import { formDataToObject } from "@/lib/validation";
import { loginSchema, normalizeIdentifier } from "@/lib/validation/schemas";

export type LoginState = Pick<ApiFailure["error"], "message" | "fieldErrors"> | null;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = formDataToObject(formData);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { message: ERROR_CODES.VALIDATION_ERROR.message, fieldErrors: zodFieldErrors(parsed.error) };

  // Throttle by IP and by account to slow credential stuffing / brute force.
  const { ip } = await getRequestMeta();
  const [byIp, byAcct] = await Promise.all([
    rateLimit(`login:ip:${ip ?? "unknown"}`, { limit: 20, windowMs: 15 * 60_000 }),
    rateLimit(`login:acct:${normalizeIdentifier(parsed.data.identifier)!.value}`, { limit: 8, windowMs: 15 * 60_000 }),
  ]);
  if (!byIp.allowed || !byAcct.allowed) return { message: ERROR_CODES.RATE_LIMITED.message };

  try {
    await signIn("credentials", {
      identifier: parsed.data.identifier,
      password: parsed.data.password,
      redirectTo: safeRedirectPath(raw.callbackUrl),
    });
  } catch (err) {
    if (err instanceof AuthError) return { message: "Incorrect email or password, or the account is temporarily locked." };
    throw err; // NEXT_REDIRECT on success
  }
  return null;
}

export async function logoutAction() {
  const ctx = await getContext();
  if (ctx) await recordAudit({ action: AUDIT_ACTIONS.LOGOUT, tenantId: ctx.user.tenantId, actorId: ctx.user.id });
  await signOut({ redirectTo: "/login" });
}
