import { AppError } from "@/lib/errors";
import { permissionsForRole } from "./roles";
import type { Permission, RoleKey } from "./constants";

export * from "./constants";
export { ROLE_PERMISSIONS, STAFF_APP_ROLES, permissionsForRole } from "./roles";

export function can(role: RoleKey, permission: Permission): boolean {
  return permissionsForRole(role).has(permission);
}

export function canAny(role: RoleKey, permissions: readonly Permission[]): boolean {
  const granted = permissionsForRole(role);
  return permissions.some((p) => granted.has(p));
}

/** Throws FORBIDDEN. Use in route handlers / server actions after resolving the user. */
export function assertCan(role: RoleKey, permission: Permission): void {
  if (!can(role, permission)) throw new AppError("FORBIDDEN");
}
