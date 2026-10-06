import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { parseModules, CORE_MODULES, type ModuleKey } from "@/config/modules";
import { can, permissionsForRole, ROLES, type Permission, type RoleKey } from "@/lib/permissions";
import { resolveBrandColors, type BrandColors } from "@/theme/tokens";

export interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  isDemo: boolean;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  customDomain: string | null;
  subdomain: string | null;
  brand: BrandColors;
  planName: string | null;
  subscriptionStatus: string | null;
}

/** Everything a request needs to know about WHO is calling and WHICH clinic they act for. */
export interface RequestContext {
  user: { id: string; name: string; email: string; role: RoleKey; tenantId: string | null };
  /** null only for SUPER_ADMIN (platform level, no clinic workspace) */
  tenant: TenantInfo | null;
  permissions: ReadonlySet<Permission>;
  enabledModules: readonly ModuleKey[];
}

/** Context with a guaranteed tenant — pass to `tenantDb(ctx)`. */
export type TenantRequestContext = RequestContext & { tenant: TenantInfo; tenantId: string };

/**
 * Resolves the caller from the session cookie, then RE-VALIDATES against the database
 * (user active, tenant active, role current). Null when signed out or no longer allowed.
 */
export const getContext = cache(async (): Promise<RequestContext | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const row = await db.user.findFirst({
    where: { id: userId, deletedAt: null, status: "ACTIVE" },
    include: {
      role: { select: { key: true } },
      tenant: { include: { branding: true, subscription: { include: { plan: true } } } },
    },
  });
  if (!row) return null;
  const role = row.role.key as RoleKey;
  if (!(ROLES as readonly string[]).includes(role)) return null;
  if (row.tenantId && (row.tenant?.status !== "ACTIVE" || row.tenant.deletedAt)) return null;

  const t = row.tenant;
  const sub = t?.subscription;
  const subActive = sub && ["TRIAL", "ACTIVE"].includes(sub.status);
  const tenant: TenantInfo | null = t
    ? {
        id: t.id, name: t.name, slug: t.slug, isDemo: t.isDemo, logoUrl: t.branding?.logoUrl ?? null,
        contactEmail: t.contactEmail, contactPhone: t.contactPhone, address: t.address,
        customDomain: t.customDomain, subdomain: t.subdomain,
        brand: resolveBrandColors(t.branding),
        planName: sub?.plan.name ?? null, subscriptionStatus: sub?.status ?? null,
      }
    : null;

  return {
    user: { id: row.id, name: row.name, email: row.email, role, tenantId: row.tenantId },
    tenant,
    permissions: permissionsForRole(role),
    // A lapsed/missing subscription falls back to the foundation modules only.
    enabledModules: tenant && subActive ? parseModules(sub.plan.modules) : [...CORE_MODULES],
  };
});

function hasTenant(ctx: RequestContext): ctx is TenantRequestContext {
  return !!ctx.tenant && !!ctx.user.tenantId;
}

/* ---------- For pages & layouts (redirect on failure) ---------- */

export async function requireContext(): Promise<RequestContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

/** Page-level guard: signed in AND holding the permission, else redirect. */
export async function requirePagePermission(permission: Permission): Promise<RequestContext> {
  const ctx = await requireContext();
  if (!can(ctx.user.role, permission)) redirect("/forbidden");
  return ctx;
}

/* ---------- For API routes & server actions (throw AppError) ---------- */

export async function requireApiContext(permission?: Permission): Promise<RequestContext> {
  const ctx = await getContext();
  if (!ctx) throw new AppError("UNAUTHENTICATED");
  if (permission && !can(ctx.user.role, permission)) throw new AppError("FORBIDDEN");
  return ctx;
}

/** Like requireApiContext but also guarantees a clinic workspace (not a platform-only user). */
export async function requireTenantApiContext(permission?: Permission): Promise<TenantRequestContext> {
  const ctx = await requireApiContext(permission);
  if (!hasTenant(ctx)) throw new AppError("FORBIDDEN", { message: "This action needs a clinic workspace." });
  return { ...ctx, tenant: ctx.tenant, tenantId: ctx.tenant.id };
}
