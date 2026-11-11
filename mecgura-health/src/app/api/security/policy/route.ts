import { apiRoute, readJson } from "@/lib/api/handler";
import type { RequestContext, TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getSecurityPolicy, getTenantMfaRoles, saveSecurityPolicy, saveTenantMfaRoles } from "@/lib/services/sec-policy";
import { reauth } from "@/lib/services/platform-core";

export const dynamic = "force-dynamic";
export const GET = apiRoute<RequestContext>({}, async ({ ctx }) => (ctx.user.role === "SUPER_ADMIN" && !ctx.tenant ? { scope: "platform", policy: await getSecurityPolicy() } : ctx.tenant && ctx.permissions.has("security.manage") ? { scope: "clinic", mfaRequiredRoles: await getTenantMfaRoles(ctx.tenant.id), platform: (await getSecurityPolicy()).mfaRequiredRoles } : (() => { throw new AppError("FORBIDDEN"); })()));
/** Security settings are sensitive: they need the caller's password (and authenticator code if enabled). */
export const PUT = apiRoute<RequestContext>({}, async ({ ctx, req }) => {
  const b = (await readJson(req)) as { password?: string; mfaRequiredRoles?: string[]; auditRetentionDays?: number | null; passwordResetMinutes?: number };
  if (ctx.user.role === "SUPER_ADMIN" && !ctx.tenant) { await reauth(ctx, b.password, "security_policy"); const { password: _p, ...rest } = b; void _p; return saveSecurityPolicy(ctx, rest); }
  if (!ctx.tenant || !ctx.permissions.has("security.manage")) throw new AppError("FORBIDDEN");
  await reauth(ctx, b.password, "security_policy"); return saveTenantMfaRoles(ctx as TenantRequestContext, b.mfaRequiredRoles ?? []);
});
