import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { isEmailConfigured, sendMail } from "@/lib/mailer";
import { siteConfig } from "@/config/site";

export const BCRYPT_ROUNDS = 12;
const RESET_TTL_MS = 30 * 60_000;

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export async function updateProfile(userId: string, name: string, req?: Request) {
  const user = await db.user.update({ where: { id: userId }, data: { name }, select: { id: true, name: true, email: true } });
  await audit({ action: "user.updated", actorUserId: userId, targetType: "user", targetId: userId, metadata: { fields: ["name"] }, req });
  return user;
}

/** Changes the password and bumps sessionVersion, which signs out every other session. */
export async function changePassword(userId: string, currentPassword: string, newPassword: string, req?: Request) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError("NOT_FOUND", "Account not found.");
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw new ApiError("VALIDATION_ERROR", "Current password is incorrect.", { details: { currentPassword: ["Current password is incorrect."] } });
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), sessionVersion: { increment: 1 } },
  });
  await audit({ action: "auth.password_changed", actorUserId: userId, targetType: "user", targetId: userId, req });
  await notify({ userId, type: "security", title: "Your password was changed", body: "If this wasn't you, contact your administrator immediately.", link: "/settings/security" });
}

export async function revokeAllSessions(userId: string, req?: Request) {
  await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
  await audit({ action: "auth.sessions_revoked", actorUserId: userId, targetType: "user", targetId: userId, req });
}

/**
 * Starts a password reset. Response never reveals whether the account exists.
 * Throws SERVICE_UNAVAILABLE in production when no email provider is set, so
 * the UI can tell the user to contact the admin instead of faking success.
 */
export async function requestPasswordReset(email: string, req?: Request): Promise<void> {
  if (!isEmailConfigured() && process.env.NODE_ENV === "production") {
    throw new ApiError("SERVICE_UNAVAILABLE", "Password reset by email is not available yet. Please contact your MECGURA administrator.");
  }
  const user = await db.user.findUnique({ where: { email } });
  if (!user || user.status !== "active") return;

  const raw = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
    db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    }),
  ]);
  // Link is built from the configured site URL, never from the Host header.
  const link = `${siteConfig.url.replace(/\/$/, "")}/reset-password?token=${raw}`;
  await sendMail(
    user.email,
    "Reset your MECGURA password",
    `Hi ${user.name ?? ""},\n\nUse the link below to set a new password. It expires in 30 minutes and can be used once.\n\n${link}\n\nIf you didn't request this, you can ignore this email.\n\n— MECGURA`
  );
  await audit({ action: "auth.password_reset_requested", actorUserId: user.id, targetType: "user", targetId: user.id, req });
}

export async function resetPassword(rawToken: string, newPassword: string, req?: Request): Promise<void> {
  const token = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now()) {
    throw new ApiError("VALIDATION_ERROR", "This reset link is invalid or has expired. Please request a new one.");
  }
  const passwordHash = await hashPassword(newPassword);
  // Atomically claim the token so it can only ever be used once.
  const claimed = await db.passwordResetToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new ApiError("VALIDATION_ERROR", "This reset link has already been used.");
  await db.user.update({ where: { id: token.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
  await audit({ action: "auth.password_reset", actorUserId: token.userId, targetType: "user", targetId: token.userId, req });
  await notify({ userId: token.userId, type: "security", title: "Your password was reset", body: "All previous sessions were signed out.", link: "/settings/security" });
}
