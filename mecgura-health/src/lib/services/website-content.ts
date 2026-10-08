import { assertFeature } from "./entitlements";
import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError, zodFieldErrors } from "@/lib/errors";
import { assertPermission } from "@/lib/permissions";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { domainRequestSchema } from "@/lib/validation/website";
import { SECTION_KEYS, parseContent, serializeContent, siteContentSchema, type SectionKey, type SiteContent } from "@/lib/website/content";
import { assertOwnImages } from "./website-shared";

/** Singleton-per-clinic website record + its DRAFT/PUBLISHED content document. */
export async function ensureWebsite(ctx: TenantRequestContext) {
  return tenantDb(ctx).website.upsert({ where: { tenantId: ctx.tenantId }, update: {}, create: { tenantId: ctx.tenantId } as never });
}

export async function getDraft(ctx: TenantRequestContext) {
  assertPermission(ctx.permissions, "website.view");
  const w = await ensureWebsite(ctx);
  const draft = parseContent(w.draftContent);
  const published = w.publishedContent ? parseContent(w.publishedContent) : null;
  return { website: w, draft, hasUnpublishedChanges: !published || serializeContent(published) !== serializeContent(draft) };
}

/** Saves ONE section of the draft (never touches what visitors see). */
export async function saveSection(ctx: TenantRequestContext, section: string, data: unknown): Promise<SiteContent> {
  assertPermission(ctx.permissions, "website.edit");
  if (!(SECTION_KEYS as readonly string[]).includes(section)) throw new AppError("VALIDATION_ERROR", { message: "Unknown section." });
  const w = await ensureWebsite(ctx);
  const merged = { ...parseContent(w.draftContent), [section as SectionKey]: data };
  const parsed = siteContentSchema.safeParse(merged);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", { fieldErrors: zodFieldErrors(parsed.error) });
  const c = parsed.data;
  await assertOwnImages(ctx, [c.hero.imageUrl, c.seo.ogImageUrl], section === "seo" ? "seo.ogImageUrl" : "hero.imageUrl");
  await tenantDb(ctx).website.update({ where: { tenantId: ctx.tenantId } as never, data: { draftContent: serializeContent(c) } });
  await recordAudit({ action: AUDIT_ACTIONS.WEBSITE_CONTENT_SAVED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "website", entityId: w.id, metadata: { section } });
  return c;
}

/** Publish = copy the validated DRAFT to the PUBLISHED snapshot and switch the site live. */
export async function publishSite(ctx: TenantRequestContext) {
  assertPermission(ctx.permissions, "website.publish");
  const w = await ensureWebsite(ctx);
  const content = serializeContent(parseContent(w.draftContent));
  await tenantDb(ctx).website.update({ where: { tenantId: ctx.tenantId } as never, data: { status: "PUBLISHED", publishedContent: content, publishedAt: new Date(), publishedById: ctx.user.id } });
  await recordAudit({ action: AUDIT_ACTIONS.WEBSITE_PUBLISHED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "website", entityId: w.id });
  return { status: "PUBLISHED" as const };
}

/** Takes the site offline (visitors see a "coming soon" page). Content is kept. */
export async function unpublishSite(ctx: TenantRequestContext) {
  assertPermission(ctx.permissions, "website.publish");
  const w = await ensureWebsite(ctx);
  await tenantDb(ctx).website.update({ where: { tenantId: ctx.tenantId } as never, data: { status: "DRAFT" } });
  await recordAudit({ action: AUDIT_ACTIONS.WEBSITE_UNPUBLISHED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "website", entityId: w.id });
  return { status: "DRAFT" as const };
}

export type DomainStatus = "NOT_CONNECTED" | "PENDING_VERIFICATION" | "VERIFIED" | "ACTIVE" | "ERROR";

/**
 * Honest domain state. ACTIVE only when a Super Admin verified the domain (DNS+SSL confirmed outside the app) AND the
 * site is published. ERROR is reserved for automated checks, which do not exist yet.
 */
export function domainStatus(o: { customDomain: string | null; verified: boolean; requested: string | null; published: boolean }): DomainStatus {
  if (o.customDomain) return o.verified ? (o.published ? "ACTIVE" : "VERIFIED") : "PENDING_VERIFICATION";
  return o.requested ? "PENDING_VERIFICATION" : "NOT_CONNECTED";
}

/** A clinic admin REQUESTS a custom domain; only a Super Admin can attach/verify it (prevents domain hijacking). */
export async function requestDomain(ctx: TenantRequestContext, input: unknown) {
  assertPermission(ctx.permissions, "clinic.settings");
  const { domain } = parseOrThrow(domainRequestSchema, input);
  await assertFeature(ctx.tenantId, "customDomain", "A custom domain is not included in your plan. Upgrade your plan to use your own domain.");
  const taken = await db.tenant.findFirst({ where: { customDomain: domain, id: { not: ctx.tenantId } }, select: { id: true } });
  if (taken) throw new AppError("CONFLICT", { fieldErrors: { domain: "This domain is already in use." } });
  const w = await ensureWebsite(ctx);
  await tenantDb(ctx).website.update({ where: { tenantId: ctx.tenantId } as never, data: { requestedDomain: domain, domainRequestedAt: new Date() } });
  await recordAudit({ action: AUDIT_ACTIONS.WEBSITE_DOMAIN_REQUESTED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "website", entityId: w.id, metadata: { domain } });
  return { requested: domain };
}

export async function overview(ctx: TenantRequestContext) {
  assertPermission(ctx.permissions, "website.view");
  const tdb = tenantDb(ctx);
  const [{ website, draft, hasUnpublishedChanges }, services, doctors, testimonials, faqs, articles, newEnquiries, branding, tenant] = await Promise.all([
    getDraft(ctx),
    tdb.websiteService.count({ where: { status: "PUBLISHED", deletedAt: null } }),
    tdb.doctorPublicProfile.count({ where: { status: "PUBLISHED" } }),
    tdb.testimonial.count({ where: { status: "PUBLISHED" } }),
    tdb.faqItem.count({ where: { status: "PUBLISHED" } }),
    tdb.article.count({ where: { status: "PUBLISHED" } }),
    ctx.permissions.has("enquiries.view") ? tdb.contactEnquiry.count({ where: { status: "NEW" } }) : Promise.resolve(0),
    db.tenantBranding.findUnique({ where: { tenantId: ctx.tenantId } }),
    db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { contactPhone: true, address: true, city: true, customDomain: true, customDomainVerifiedAt: true } }),
  ]);
  const hoursSet = Object.values(draft.clinic.hours).some((d) => d.open);
  const status = domainStatus({ customDomain: tenant?.customDomain ?? null, verified: !!tenant?.customDomainVerifiedAt, requested: website.requestedDomain, published: website.status === "PUBLISHED" });
  return {
    status: website.status as "DRAFT" | "PUBLISHED", publishedAt: website.publishedAt, hasUnpublishedChanges, domainStatus: status, newEnquiries,
    checklist: [
      { key: "doctor", label: "Doctor profile published", done: doctors > 0, href: "/website/doctors" },
      { key: "clinic", label: "Clinic information", done: !!(tenant?.contactPhone && tenant.address && tenant.city && hoursSet), href: "/website/pages?section=clinic", hint: "Phone, address and opening hours" },
      { key: "branding", label: "Branding", done: !!(branding?.logoUrl || branding?.primaryColor), href: "/settings/branding" },
      { key: "services", label: "Services", done: services > 0, href: "/website/services" },
      { key: "testimonials", label: "Testimonials", done: testimonials > 0, href: "/website/testimonials", optional: true },
      { key: "faq", label: "FAQ", done: faqs > 0, href: "/website/faq", optional: true },
      { key: "articles", label: "Articles", done: articles > 0, href: "/website/articles", optional: true },
      { key: "domain", label: "Custom domain", done: status === "ACTIVE", href: "/website/domain", optional: true },
    ],
  };
}
