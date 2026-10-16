import { AppError } from "@/lib/errors";
import { permissionsForRole } from "./roles";
import type { Permission, RoleKey } from "./constants";

export * from "./constants";
export { ROLE_PERMISSIONS, STAFF_APP_ROLES, TENANT_ASSIGNABLE_ROLES, permissionsForRole, effectivePermissions } from "./roles";

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

/** Throws FORBIDDEN unless the request's EFFECTIVE permissions (role + per-user grants) include `permission`. */
export function assertPermission(granted: ReadonlySet<Permission>, permission: Permission): void {
  if (!granted.has(permission)) throw new AppError("FORBIDDEN");
}
