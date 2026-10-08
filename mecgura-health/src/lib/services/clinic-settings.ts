import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { assertPermission } from "@/lib/permissions";
import { validateImage, type ImageKind } from "@/lib/security/images";
import { tenantDb } from "@/lib/tenant/db";
import type { BrandingInput, ClinicProfileInput } from "@/lib/validation/clinic";
import { changedKeys } from "./shared";

/** Clinic-side settings. The clinic is ALWAYS ctx.tenantId (derived from the session), never client input. */

export async function updateOwnProfile(ctx: TenantRequestContext, input: ClinicProfileInput) {
  assertPermission(ctx.permissions, "clinic.edit");
  const before = await db.tenant.findFirst({ where: { id: ctx.tenantId, deletedAt: null } });
  if (!before) throw new AppError("NOT_FOUND");
  const updated = await db.tenant.update({ where: { id: ctx.tenantId }, data: input });
  await recordAudit({ action: AUDIT_ACTIONS.CLINIC_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "tenant", entityId: ctx.tenantId, metadata: { fields: changedKeys(before, input) } });
  return updated;
}

export async function updateBranding(ctx: TenantRequestContext, input: BrandingInput) {
  assertPermission(ctx.permissions, "clinic.settings");
  const data = { primaryColor: input.primaryColor, secondaryColor: input.secondaryColor, accentColor: input.accentColor };
  await db.tenantBranding.upsert({ where: { tenantId: ctx.tenantId }, update: data, create: { tenantId: ctx.tenantId, ...data } });
  await recordAudit({ action: AUDIT_ACTIONS.BRANDING_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "tenant", entityId: ctx.tenantId, metadata: { colours: true } });
  return data;
}

/** Back to the MECGURA default colours (logo/favicon are kept; remove them separately). */
export async function resetBranding(ctx: TenantRequestContext) {
  assertPermission(ctx.permissions, "clinic.settings");
  await db.tenantBranding.upsert({
    where: { tenantId: ctx.tenantId },
    update: { primaryColor: null, secondaryColor: null, accentColor: null },
    create: { tenantId: ctx.tenantId },
  });
  await recordAudit({ action: AUDIT_ACTIONS.BRANDING_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "tenant", entityId: ctx.tenantId, metadata: { reset: true } });
}

/**
 * Stores a validated image and points the right column at it.
 * LOGO/FAVICON need clinic.settings; AVATAR needs users.edit (or is the user's own photo).
 */
export async function saveImage(ctx: TenantRequestContext, kind: ImageKind, bytes: Uint8Array, ownerId = "") {
  if (kind === "AVATAR") {
    if (!ownerId) throw new AppError("VALIDATION_ERROR");
    if (ownerId !== ctx.user.id) assertPermission(ctx.permissions, "users.edit");
    const target = await tenantDb(ctx).user.findFirst({ where: { id: ownerId }, select: { id: true } });
    if (!target) throw new AppError("NOT_FOUND");
  } else {
    assertPermission(ctx.permissions, "clinic.settings");
    ownerId = "";
  }
  const check = validateImage(kind, bytes);
  if (!check.ok) throw new AppError("VALIDATION_ERROR", { message: check.message, fieldErrors: { file: check.message } });

  const tdb = tenantDb(ctx);
  const data = Buffer.from(bytes);
  const asset = await tdb.tenantAsset.upsert({
    where: { tenantId_kind_ownerId: { tenantId: ctx.tenantId, kind, ownerId } },
    update: { mimeType: check.mime, size: data.length, data },
    create: { tenantId: ctx.tenantId, kind, ownerId, mimeType: check.mime, size: data.length, data },
    select: { id: true },
  });
  const url = `/api/assets/${asset.id}?v=${Date.now()}`;
  if (kind === "AVATAR") await tdb.user.update({ where: { id: ownerId }, data: { avatarUrl: url } });
  else {
    const col = kind === "LOGO" ? { logoUrl: url } : { faviconUrl: url };
    await db.tenantBranding.upsert({ where: { tenantId: ctx.tenantId }, update: col, create: { tenantId: ctx.tenantId, ...col } });
    await recordAudit({ action: AUDIT_ACTIONS.BRANDING_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "tenant", entityId: ctx.tenantId, metadata: { asset: kind } });
  }
  return { url };
}

export async function removeImage(ctx: TenantRequestContext, kind: ImageKind, ownerId = "") {
  if (kind === "AVATAR") {
    if (ownerId !== ctx.user.id) assertPermission(ctx.permissions, "users.edit");
  } else {
    assertPermission(ctx.permissions, "clinic.settings");
    ownerId = "";
  }
  const tdb = tenantDb(ctx);
  await tdb.tenantAsset.deleteMany({ where: { kind, ownerId } });
  if (kind === "AVATAR") await tdb.user.updateMany({ where: { id: ownerId }, data: { avatarUrl: null } });
  else {
    await db.tenantBranding.updateMany({ where: { tenantId: ctx.tenantId }, data: kind === "LOGO" ? { logoUrl: null } : { faviconUrl: null } });
    await recordAudit({ action: AUDIT_ACTIONS.BRANDING_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "tenant", entityId: ctx.tenantId, metadata: { assetRemoved: kind } });
  }
}
