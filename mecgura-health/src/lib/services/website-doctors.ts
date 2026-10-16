import "server-only";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { assertPermission } from "@/lib/permissions";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { doctorProfileSchema } from "@/lib/validation/website";
import { slugify, uniqueSlug } from "@/lib/website/slug";
import { assertOwnImages, jsonList, parseList } from "./website-shared";

/** Public doctor profiles. Clinical identity (qualification, experience, registration, fee) lives on Phase 1's DoctorProfile. */

const canEditProfile = (ctx: TenantRequestContext, userId: string) => ctx.permissions.has("website.edit") || (ctx.permissions.has("website.profile") && userId === ctx.user.id);

export async function listDoctors(ctx: TenantRequestContext) {
  assertPermission(ctx.permissions, "website.view");
  const all = ctx.permissions.has("website.edit");
  const rows = await tenantDb(ctx).user.findMany({
    where: { role: { key: "DOCTOR" }, status: { not: "DISABLED" }, ...(all ? {} : { id: ctx.user.id }) },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, status: true, doctorProfile: { select: { specialization: true, qualification: true } }, doctorPublicProfile: { select: { slug: true, status: true, sortOrder: true, updatedAt: true } } },
  });
  return rows;
}

export async function getDoctorForEdit(ctx: TenantRequestContext, userId: string) {
  assertPermission(ctx.permissions, "website.view");
  if (!canEditProfile(ctx, userId) && !ctx.permissions.has("website.view")) throw new AppError("FORBIDDEN");
  const user = await tenantDb(ctx).user.findFirst({
    where: { id: userId, role: { key: "DOCTOR" } },
    select: { id: true, name: true, doctorProfile: true, doctorPublicProfile: true },
  });
  if (!user) throw new AppError("NOT_FOUND");
  const p = user.doctorPublicProfile;
  return {
    userId: user.id, name: user.name, clinical: user.doctorProfile,
    editable: canEditProfile(ctx, userId),
    profile: p ? { ...p, certifications: parseList(p.certifications), memberships: parseList(p.memberships), languages: parseList(p.languages) } : null,
  };
}

export async function saveDoctorProfile(ctx: TenantRequestContext, userId: string, raw: unknown) {
  if (!canEditProfile(ctx, userId)) throw new AppError("FORBIDDEN");
  const tdb = tenantDb(ctx);
  const user = await tdb.user.findFirst({ where: { id: userId, role: { key: "DOCTOR" } }, select: { name: true } });
  if (!user) throw new AppError("NOT_FOUND");
  const input = parseOrThrow(doctorProfileSchema, raw);
  await assertOwnImages(ctx, [input.photoUrl], "photoUrl");
  const cur = await tdb.doctorPublicProfile.findFirst({ where: { userId } });

  const base = input.slug ?? cur?.slug ?? slugify(user.name, "doctor");
  const taken = new Set((await tdb.doctorPublicProfile.findMany({ where: { slug: { startsWith: base.slice(0, 60) }, ...(cur ? { id: { not: cur.id } } : {}) }, select: { slug: true } })).map((r) => r.slug));
  if (input.slug && taken.has(input.slug)) throw new AppError("CONFLICT", { fieldErrors: { slug: "This URL name is already used. Choose another." } });
  const slug = input.slug ?? uniqueSlug(base, taken);

  const data = {
    slug, photoUrl: input.photoUrl ?? null, photoAlt: input.photoAlt ?? null, shortBio: input.shortBio ?? null, bio: input.bio ?? null, education: input.education ?? null,
    certifications: jsonList(input.certifications), memberships: jsonList(input.memberships), languages: jsonList(input.languages), philosophy: input.philosophy ?? null,
    showRegistration: input.showRegistration, showFee: input.showFee, sortOrder: input.sortOrder, seoTitle: input.seoTitle ?? null, seoDescription: input.seoDescription ?? null,
  };
  // Without publish rights an edit to a live profile takes it back to DRAFT (an admin re-publishes after review).
  const reverted = cur?.status === "PUBLISHED" && !ctx.permissions.has("website.publish");
  await tdb.doctorPublicProfile.upsert({
    where: { userId },
    update: { ...data, ...(reverted ? { status: "DRAFT" } : {}) },
    create: { tenantId: ctx.tenantId, userId, ...data, status: "DRAFT" } as never,
  });
  await recordAudit({ action: AUDIT_ACTIONS.DOCTOR_PROFILE_UPDATED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "doctor_profile", entityId: userId, metadata: reverted ? { revertedToDraft: true } : undefined });
  return { slug, revertedToDraft: reverted };
}

export async function setDoctorStatus(ctx: TenantRequestContext, userId: string, status: "DRAFT" | "PUBLISHED" | "ARCHIVED") {
  if (status === "PUBLISHED") assertPermission(ctx.permissions, "website.publish");
  else if (!canEditProfile(ctx, userId)) throw new AppError("FORBIDDEN");
  const tdb = tenantDb(ctx);
  const cur = await tdb.doctorPublicProfile.findFirst({ where: { userId } });
  if (!cur) throw new AppError("VALIDATION_ERROR", { message: "Save the profile before publishing it." });
  if (cur.status === status) return { status };
  await tdb.doctorPublicProfile.update({ where: { userId }, data: { status, ...(status === "PUBLISHED" && !cur.publishedAt ? { publishedAt: new Date() } : {}) } });
  await recordAudit({ action: AUDIT_ACTIONS.DOCTOR_PROFILE_STATUS_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "doctor_profile", entityId: userId, metadata: { from: cur.status, to: status } });
  return { status };
}
