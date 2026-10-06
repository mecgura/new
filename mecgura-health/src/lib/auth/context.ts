import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { parseModules, CORE_MODULES, type ModuleKey } from "@/config/modules";
import { TENANT_ACCESS_STATUSES } from "@/lib/domain/constants";
import { effectivePermissions, ROLES, type Permission, type RoleKey } from "@/lib/permissions";
import { resolveBrandColors, type BrandColors } from "@/theme/tokens";
import { WORKSPACE_COOKIE, verifyWorkspaceToken } from "./workspace-cookie";

export interface TenantInfo {
  id: string;
  name: string;
  legalName: string | null;
  slug: string;
  clinicType: string;
  status: string;
  isDemo: boolean;
  logoUrl: string | null;
  faviconUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  alternatePhone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  pincode: string | null;
  timezone: string;
  websiteEnabled: boolean;
  customDomain: string | null;
  customDomainVerified: boolean;
  subdomain: string | null;
  brand: BrandColors;
  planName: string | null;
  subscriptionStatus: string | null;
}

/** Everything a request needs to know about WHO is calling and WHICH clinic they act for. */
export interface RequestContext {
  user: { id: string; name: string; email: string; role: RoleKey; tenantId: string | null; avatarUrl: string | null };
  /** The clinic this request operates on. Always derived server-side — never from client input. */
  tenant: TenantInfo | null;
  permissions: ReadonlySet<Permission>;
  enabledModules: readonly ModuleKey[];
  /** true when a SUPER_ADMIN is inside a clinic workspace ("Viewing as Super Admin") */
  viewingAs: boolean;
}

/** Context with a guaranteed tenant — pass to `tenantDb(ctx)`. */
export type TenantRequestContext = RequestContext & { tenant: TenantInfo; tenantId: string };

export type BlockReason = "tenant_unavailable" | "user_unavailable";
interface Access { ctx: RequestContext | null; blocked: BlockReason | null }

const tenantInclude = { branding: true, subscription: { include: { plan: true } } } as const;
type TenantRow = NonNullable<Awaited<ReturnType<typeof loadTenant>>>;
const loadTenant = (id: string) => db.tenant.findFirst({ where: { id, deletedAt: null }, include: tenantInclude });

function toTenantInfo(t: TenantRow): TenantInfo {
  return {
    id: t.id, name: t.name, legalName: t.legalName, slug: t.slug, clinicType: t.clinicType, status: t.status, isDemo: t.isDemo,
    logoUrl: t.branding?.logoUrl ?? null, faviconUrl: t.branding?.faviconUrl ?? null,
    contactEmail: t.contactEmail, contactPhone: t.contactPhone, alternatePhone: t.alternatePhone,
    address: t.address, city: t.city, state: t.state, country: t.country, pincode: t.pincode, timezone: t.timezone,
    websiteEnabled: t.websiteEnabled, customDomain: t.customDomain, customDomainVerified: !!t.customDomainVerifiedAt, subdomain: t.subdomain,
    brand: resolveBrandColors(t.branding),
    planName: t.subscription?.plan.name ?? null, subscriptionStatus: t.subscription?.status ?? null,
  };
}

function modulesFor(t: TenantRow | null, role: RoleKey): ModuleKey[] {
  const isSuper = role === "SUPER_ADMIN";
  if (!t) return isSuper ? ["dashboard", "settings", "platform"] : [...CORE_MODULES];
  const sub = t.subscription;
  const open = sub && ["TRIAL", "ACTIVE"].includes(sub.status) && TENANT_ACCESS_STATUSES.includes(t.status);
  const base = open ? parseModules(sub.plan.modules) : [...CORE_MODULES];
  return isSuper ? [...base, "platform"] : base;
}

/**
 * Resolves the caller from the session cookie, then RE-VALIDATES against the database on every request:
 * user must be ACTIVE, their clinic must be ACTIVE/TRIAL, and the role/permissions are re-read.
 * Suspending a clinic or disabling a user therefore takes effect on the very next request.
 */
export const getAccess = cache(async (): Promise<Access> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ctx: null, blocked: null };

  const row = await db.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: { role: { select: { key: true } }, permissionGrants: { select: { permission: true } } },
  });
  if (!row || row.status !== "ACTIVE") return { ctx: null, blocked: "user_unavailable" };
  const role = row.role.key as RoleKey;
  if (!(ROLES as readonly string[]).includes(role)) return { ctx: null, blocked: "user_unavailable" };

  let tenantRow: TenantRow | null = null;
  let viewingAs = false;
  if (role === "SUPER_ADMIN") {
    // Optional, signed "enter workspace" cookie. Only honoured for a Super Admin session.
    const target = verifyWorkspaceToken(process.env.AUTH_SECRET ?? "", row.id, (await cookies()).get(WORKSPACE_COOKIE)?.value);
    if (target) {
      tenantRow = await loadTenant(target);
      viewingAs = !!tenantRow;
    }
  } else {
    if (!row.tenantId) return { ctx: null, blocked: "user_unavailable" }; // tenant users MUST belong to a clinic
    tenantRow = await loadTenant(row.tenantId);
    if (!tenantRow || !TENANT_ACCESS_STATUSES.includes(tenantRow.status)) return { ctx: null, blocked: "tenant_unavailable" };
  }

  const grants = row.permissionGrants.map((g) => g.permission);
  return {
    blocked: null,
    ctx: {
      user: { id: row.id, name: row.name, email: row.email, role, tenantId: row.tenantId, avatarUrl: row.avatarUrl },
      tenant: tenantRow ? toTenantInfo(tenantRow) : null,
      permissions: effectivePermissions(role, grants),
      enabledModules: modulesFor(tenantRow, role),
      viewingAs,
    },
  };
});

export const getContext = cache(async (): Promise<RequestContext | null> => (await getAccess()).ctx);

function hasTenant(ctx: RequestContext): ctx is TenantRequestContext {
  return !!ctx.tenant;
}

/* ---------- For pages & layouts (redirect on failure) ---------- */

export async function requireContext(): Promise<RequestContext> {
  const { ctx, blocked } = await getAccess();
  if (!ctx) redirect(blocked ? `/login?reason=${blocked}` : "/login");
  return ctx;
}

/** Page-level guard: signed in AND holding the permission, else redirect. */
export async function requirePagePermission(permission: Permission): Promise<RequestContext> {
  const ctx = await requireContext();
  if (!ctx.permissions.has(permission)) redirect("/forbidden");
  return ctx;
}

/** Page guard for clinic screens: needs the permission AND a clinic workspace (Super Admin must enter one first). */
export async function requireTenantPagePermission(permission: Permission): Promise<TenantRequestContext> {
  const ctx = await requirePagePermission(permission);
  if (!hasTenant(ctx)) redirect("/platform/clinics");
  return { ...ctx, tenantId: ctx.tenant!.id } as TenantRequestContext;
}

/* ---------- For API routes & server actions (throw AppError) ---------- */

export async function requireApiContext(permission?: Permission): Promise<RequestContext> {
  const ctx = await getContext();
  if (!ctx) throw new AppError("UNAUTHENTICATED");
  if (permission && !ctx.permissions.has(permission)) throw new AppError("FORBIDDEN");
  return ctx;
}

/** Like requireApiContext but also guarantees a clinic workspace (not a platform-only user). */
export async function requireTenantApiContext(permission?: Permission): Promise<TenantRequestContext> {
  const ctx = await requireApiContext(permission);
  if (!hasTenant(ctx)) throw new AppError("FORBIDDEN", { message: "This action needs a clinic workspace." });
  return { ...ctx, tenant: ctx.tenant, tenantId: ctx.tenant.id };
}
