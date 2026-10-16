import { db } from "@/lib/db";
import type { RequestContext, TenantRequestContext } from "@/lib/auth/context";
import { MODULE_KEYS } from "@/config/modules";
import { effectivePermissions, ROLES, type RoleKey } from "@/lib/permissions";
import { DEFAULT_BRAND } from "@/theme/tokens";

/** Idempotent: system roles + default plan the services expect to exist. */
export async function seedSystemData() {
  for (const key of ROLES) {
    if (!(await db.role.findFirst({ where: { key, tenantId: null } }))) await db.role.create({ data: { key, name: key } });
  }
  await db.plan.upsert({ where: { key: "foundation" }, update: {}, create: { key: "foundation", name: "Foundation", modules: JSON.stringify(["dashboard", "settings", "team"]) } });
}

let n = 0;
export const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;

export async function makeUser(role: RoleKey, tenantId: string | null, grants: string[] = []) {
  const r = await db.role.findFirstOrThrow({ where: { key: role, tenantId: null } });
  const email = `${uniq(role.toLowerCase())}@t.test`;
  const user = await db.user.create({ data: { email, name: `${role} user`, passwordHash: "x", roleId: r.id, tenantId, status: "ACTIVE" } });
  if (tenantId && grants.length) await db.userPermissionGrant.createMany({ data: grants.map((permission) => ({ tenantId, userId: user.id, permission })) });
  return { user, grants };
}

/** Builds the same context object the server derives from a session — for calling services directly. */
export function ctxFor(u: { id: string; name: string; email: string; avatarUrl: string | null; tenantId: string | null }, role: RoleKey, tenantId: string | null, opts: { grants?: string[]; viewingAs?: boolean } = {}): RequestContext {
  return {
    user: { id: u.id, name: u.name, email: u.email, role, tenantId: u.tenantId, avatarUrl: u.avatarUrl },
    tenant: tenantId ? ({ id: tenantId, name: "T", slug: "t", brand: DEFAULT_BRAND } as never) : null,
    permissions: effectivePermissions(role, opts.grants),
    enabledModules: [...MODULE_KEYS],
    viewingAs: opts.viewingAs ?? false,
  };
}
export const asTenant = (c: RequestContext): TenantRequestContext => ({ ...c, tenant: c.tenant!, tenantId: c.tenant!.id });
