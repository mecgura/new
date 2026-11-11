/* eslint-disable @typescript-eslint/no-explicit-any -- one generic CRUD over four Prisma delegates; inputs are zod-validated, tenant scope comes from tenantDb */
import "server-only";
import type { z } from "zod";
import { AUDIT_ACTIONS, recordAudit, type AuditAction } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { assertPermission, type Permission } from "@/lib/permissions";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { articleSchema, faqSchema, serviceSchema, testimonialSchema } from "@/lib/validation/website";
import { slugify, uniqueSlug } from "@/lib/website/slug";
import { containsCI, pageParams, PAGE_SIZE } from "./shared";
import { assertOwnImages, jsonList, parseList } from "./website-shared";

export type ResourceKey = "services" | "testimonials" | "faq" | "articles";
export type ItemStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

interface Def {
  model: "websiteService" | "testimonial" | "faqItem" | "article";
  schema: z.ZodType<any, any>;
  slug: boolean;
  /** column searched by ?q= */
  titleCol: string;
  images: string[];
  audit: { created: AuditAction; updated: AuditAction; status: AuditAction };
  /** permission to create/edit; website.articles lets doctors draft their own articles */
  editPerms: Permission[];
  soft: boolean;
  order: any[];
}

const DEFS: Record<ResourceKey, Def> = {
  services: { model: "websiteService", schema: serviceSchema, slug: true, titleCol: "title", images: ["imageUrl"], audit: { created: AUDIT_ACTIONS.SERVICE_CREATED, updated: AUDIT_ACTIONS.SERVICE_UPDATED, status: AUDIT_ACTIONS.SERVICE_STATUS_CHANGED }, editPerms: ["website.edit"], soft: true, order: [{ sortOrder: "asc" }, { title: "asc" }] },
  testimonials: { model: "testimonial", schema: testimonialSchema, slug: false, titleCol: "text", images: [], audit: { created: AUDIT_ACTIONS.TESTIMONIAL_CREATED, updated: AUDIT_ACTIONS.TESTIMONIAL_UPDATED, status: AUDIT_ACTIONS.TESTIMONIAL_STATUS_CHANGED }, editPerms: ["website.edit"], soft: false, order: [{ sortOrder: "asc" }, { createdAt: "desc" }] },
  faq: { model: "faqItem", schema: faqSchema, slug: false, titleCol: "question", images: [], audit: { created: AUDIT_ACTIONS.FAQ_CREATED, updated: AUDIT_ACTIONS.FAQ_UPDATED, status: AUDIT_ACTIONS.FAQ_STATUS_CHANGED }, editPerms: ["website.edit"], soft: false, order: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
  articles: { model: "article", schema: articleSchema, slug: true, titleCol: "title", images: ["featuredImageUrl", "ogImageUrl"], audit: { created: AUDIT_ACTIONS.ARTICLE_CREATED, updated: AUDIT_ACTIONS.ARTICLE_UPDATED, status: AUDIT_ACTIONS.ARTICLE_STATUS_CHANGED }, editPerms: ["website.edit", "website.articles"], soft: false, order: [{ updatedAt: "desc" }] },
};

export const isResource = (k: string): k is ResourceKey => k in DEFS;
const def = (k: string): Def => { if (!isResource(k)) throw new AppError("NOT_FOUND"); return DEFS[k]; };
const delegate = (ctx: TenantRequestContext, d: Def): any => (tenantDb(ctx) as any)[d.model];
const canEdit = (ctx: TenantRequestContext, d: Def) => d.editPerms.some((p) => ctx.permissions.has(p));
/** Doctors with only website.articles may touch THEIR OWN articles only. */
const ownOnly = (ctx: TenantRequestContext, k: ResourceKey) => k === "articles" && !ctx.permissions.has("website.edit");

function guardEdit(ctx: TenantRequestContext, d: Def) {
  if (!canEdit(ctx, d)) throw new AppError("FORBIDDEN");
}

export async function listItems(ctx: TenantRequestContext, key: string, f: { status?: string; q?: string; page?: number }) {
  const d = def(key);
  assertPermission(ctx.permissions, "website.view");
  const { skip, take, page } = pageParams(f.page, PAGE_SIZE * 2);
  const where: any = {
    ...(d.soft ? { deletedAt: null } : {}),
    ...(f.status && ["DRAFT", "PUBLISHED", "ARCHIVED"].includes(f.status) ? { status: f.status } : {}),
    ...(f.q ? { [d.titleCol]: containsCI(f.q) } : {}),
    ...(ownOnly(ctx, key as ResourceKey) ? { authorUserId: ctx.user.id } : {}),
  };
  const dl = delegate(ctx, d);
  const [total, rows] = await Promise.all([dl.count({ where }), dl.findMany({ where, orderBy: d.order, skip, take })]);
  return { total, page, pageSize: take, rows };
}

export async function getItem(ctx: TenantRequestContext, key: string, id: string) {
  const d = def(key);
  assertPermission(ctx.permissions, "website.view");
  const row = await delegate(ctx, d).findFirst({ where: { id, ...(d.soft ? { deletedAt: null } : {}), ...(ownOnly(ctx, key as ResourceKey) ? { authorUserId: ctx.user.id } : {}) } });
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

async function resolveSlug(ctx: TenantRequestContext, d: Def, title: string, wanted: string | undefined, selfId?: string) {
  const dl = delegate(ctx, d);
  const base = wanted ?? slugify(title, d.model === "article" ? "article" : "service");
  const taken = new Set<string>((await dl.findMany({ where: { slug: { startsWith: base.slice(0, 60) }, ...(selfId ? { id: { not: selfId } } : {}) }, select: { slug: true } })).map((r: { slug: string }) => r.slug));
  if (wanted) {
    if (taken.has(wanted)) throw new AppError("CONFLICT", { fieldErrors: { slug: "This URL name is already used. Choose another." } });
    return wanted;
  }
  return uniqueSlug(base, taken);
}

async function checkRefs(ctx: TenantRequestContext, key: string, input: any) {
  if (key !== "testimonials") return;
  const tdb = tenantDb(ctx);
  if (input.doctorUserId && !(await tdb.user.findFirst({ where: { id: input.doctorUserId, role: { key: "DOCTOR" } }, select: { id: true } }))) throw new AppError("VALIDATION_ERROR", { fieldErrors: { doctorUserId: "Choose a doctor from this clinic." } });
  if (input.serviceId && !(await tdb.websiteService.findFirst({ where: { id: input.serviceId, deletedAt: null }, select: { id: true } }))) throw new AppError("VALIDATION_ERROR", { fieldErrors: { serviceId: "Choose a service from this clinic." } });
}

function toData(key: ResourceKey, input: any): any {
  const data: any = { ...input };
  delete data.publishAt;
  if (key === "articles") data.tags = jsonList(input.tags ?? []);
  if (key === "testimonials") data.givenOn = input.givenOn ? new Date(`${input.givenOn}T00:00:00Z`) : null;
  for (const k of Object.keys(data)) if (data[k] === undefined) data[k] = null;
  return data;
}

export async function createItem(ctx: TenantRequestContext, key: string, raw: unknown) {
  const d = def(key); guardEdit(ctx, d);
  const input = parseOrThrow(d.schema, raw);
  await assertOwnImages(ctx, d.images.map((c) => input[c]), d.images[0]);
  await checkRefs(ctx, key, input);
  const data = toData(key as ResourceKey, input);
  if (d.slug) data.slug = await resolveSlug(ctx, d, input.title, input.slug);
  if (key === "articles") { data.authorUserId = ctx.user.id; if (input.publishAt) data.publishedAt = new Date(`${input.publishAt}T00:00:00Z`); }
  data.status = "DRAFT"; // nothing is ever published on creation
  const row = await delegate(ctx, d).create({ data });
  await recordAudit({ action: d.audit.created, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: key, entityId: row.id });
  return { id: row.id, slug: row.slug };
}

export async function updateItem(ctx: TenantRequestContext, key: string, id: string, raw: unknown) {
  const d = def(key); guardEdit(ctx, d);
  const dl = delegate(ctx, d);
  const cur = await dl.findFirst({ where: { id, ...(d.soft ? { deletedAt: null } : {}), ...(ownOnly(ctx, key as ResourceKey) ? { authorUserId: ctx.user.id } : {}) } });
  if (!cur) throw new AppError("NOT_FOUND");
  const input = parseOrThrow(d.schema, raw);
  await assertOwnImages(ctx, d.images.map((c) => input[c]), d.images[0]);
  await checkRefs(ctx, key, input);
  const data = toData(key as ResourceKey, input);
  if (d.slug) data.slug = await resolveSlug(ctx, d, input.title, input.slug ?? (cur.slug === slugify(input.title) ? undefined : cur.slug), id);
  if (key === "articles" && input.publishAt) data.publishedAt = new Date(`${input.publishAt}T00:00:00Z`);
  // Editing live content without publish rights takes it back to DRAFT so nothing changes publicly unreviewed.
  const reverted = cur.status === "PUBLISHED" && !ctx.permissions.has("website.publish");
  if (reverted) data.status = "DRAFT";
  await dl.update({ where: { id }, data });
  await recordAudit({ action: d.audit.updated, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: key, entityId: id, metadata: reverted ? { revertedToDraft: true } : undefined });
  return { id, revertedToDraft: reverted };
}

export async function setItemStatus(ctx: TenantRequestContext, key: string, id: string, status: ItemStatus) {
  const d = def(key);
  if (status === "PUBLISHED") assertPermission(ctx.permissions, "website.publish");
  else guardEdit(ctx, d);
  const dl = delegate(ctx, d);
  const cur = await dl.findFirst({ where: { id, ...(d.soft ? { deletedAt: null } : {}), ...(ownOnly(ctx, key as ResourceKey) ? { authorUserId: ctx.user.id } : {}) } });
  if (!cur) throw new AppError("NOT_FOUND");
  if (cur.status === status) return { status };
  await dl.update({ where: { id }, data: { status, ...(status === "PUBLISHED" && !cur.publishedAt ? { publishedAt: new Date() } : {}), ...(d.soft && status === "ARCHIVED" ? {} : {}) } });
  await recordAudit({ action: d.audit.status, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: key, entityId: id, metadata: { from: cur.status, to: status } });
  return { status };
}

export const rowTags = (row: { tags?: string }) => parseList(row.tags ?? "[]");
