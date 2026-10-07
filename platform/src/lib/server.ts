import { auth } from "@/auth";
import { ApiError, errorResponse } from "@/lib/api";
import { getSessionUser } from "@/lib/session";
import { audit } from "@/lib/audit";

/**
 * Require a SUPER_ADMIN for the existing admin API routes. The user is
 * re-validated against the database (status, session version, role).
 * 401 = not signed in, 403 = signed in without permission.
 */
export async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { session: null, error: errorResponse(new ApiError("UNAUTHENTICATED")) };
  if (user.platformRole !== "SUPER_ADMIN") {
    await audit({ action: "permission.denied", actorUserId: user.id, targetType: "admin", metadata: { area: "admin-api" } });
    return { session: null, error: errorResponse(new ApiError("FORBIDDEN")) };
  }
  const session = await auth();
  return { session, error: null };
}

export function parseFeatures(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((f): f is string => typeof f === "string");
    return [];
  } catch {
    return [];
  }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}
