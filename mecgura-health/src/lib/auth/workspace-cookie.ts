import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Super Admin "enter clinic workspace" state. A signed cookie binds (userId, tenantId); it is honoured
 * ONLY for a SUPER_ADMIN session (checked in getContext). Tampering or reuse by another user fails verification.
 */
export const WORKSPACE_COOKIE = "mh_workspace";

function sign(secret: string, userId: string, tenantId: string) {
  return createHmac("sha256", secret).update(`${userId}.${tenantId}`).digest("base64url");
}

export function createWorkspaceToken(secret: string, userId: string, tenantId: string): string {
  return `${tenantId}.${sign(secret, userId, tenantId)}`;
}

/** Returns the tenantId if the token is valid for this user, else null. */
export function verifyWorkspaceToken(secret: string, userId: string, token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 1) return null;
  const tenantId = token.slice(0, i);
  const given = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(sign(secret, userId, tenantId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? tenantId : null;
}
