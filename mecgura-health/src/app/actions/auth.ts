"use server";
import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { signIn, signOut } from "@/auth";
import { db } from "@/lib/db";
import { hasMfa } from "@/lib/services/sec-mfa";
import { getContext } from "@/lib/auth/context";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { ERROR_CODES, zodFieldErrors, type ApiFailure } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { getRequestMeta } from "@/lib/security/request";
import { formDataToObject } from "@/lib/validation";
import { loginSchema, normalizeIdentifier } from "@/lib/validation/schemas";

export type LoginState = (Pick<ApiFailure["error"], "message" | "fieldErrors"> & { mfaRequired?: boolean }) | null;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = formDataToObject(formData);
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { message: ERROR_CODES.VALIDATION_ERROR.message, fieldErrors: zodFieldErrors(parsed.error) };

  // Throttle by IP and by account to slow credential stuffing / brute force.
  const { ip } = await getRequestMeta();
  const [byIp, byAcct] = await Promise.all([
    rateLimit(`login:ip:${ip ?? "unknown"}`, { limit: Number(process.env.LOGIN_RATE_LIMIT_IP) || 20, windowMs: 15 * 60_000 }),
    rateLimit(`login:acct:${normalizeIdentifier(parsed.data.identifier)!.value}`, { limit: Number(process.env.LOGIN_RATE_LIMIT_ACCT) || 8, windowMs: 15 * 60_000 }),
  ]);
  if (!byIp.allowed || !byAcct.allowed) return { message: ERROR_CODES.RATE_LIMITED.message };

  const code = typeof raw.code === "string" ? raw.code.trim().slice(0, 20) : "";
  if (!code) { // ask for the second factor only AFTER the password is proven right (no hint is given for a wrong password)
    const id = normalizeIdentifier(parsed.data.identifier)!;
    const u = await db.user.findFirst({ where: { ...(id.kind === "email" ? { email: id.value } : { phone: id.value }), deletedAt: null }, select: { id: true, passwordHash: true } });
    if (u?.passwordHash && (await bcrypt.compare(parsed.data.password, u.passwordHash)) && (await hasMfa(u.id))) return { message: "Enter the 6-digit code from your authenticator app (or a backup code).", mfaRequired: true };
  }
  try {
    await signIn("credentials", {
      identifier: parsed.data.identifier,
      password: parsed.data.password,
      code,
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
