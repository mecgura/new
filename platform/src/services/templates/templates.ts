import { randomUUID } from "node:crypto";
import { Prisma, type MessageTemplate } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto";
import { publish } from "@/lib/realtime/broker";
import type { OrgAccess } from "@/lib/session";
import {
  DEFAULT_AUTH_OPTIONS,
  fromMetaComponents,
  mapMetaStatus,
  templateSlots,
  toMetaComponents,
  validateTemplate,
  type AuthOptions,
  type TemplateButton,
  type TemplateCategory,
  type TemplateDef,
  type TemplateExamples,
  type TemplateStatus,
  type HeaderType,
} from "@/lib/templates";
import { MetaApiError, graph } from "@/providers/meta/graph";
import { createTemplate as metaCreate, deleteTemplate as metaDelete, listTemplates as metaList, uploadReviewSample } from "@/providers/meta/templates";

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toDef(t: MessageTemplate): TemplateDef {
  return {
    name: t.name,
    language: t.language,
    category: t.category as TemplateCategory,
    headerType: t.headerType as HeaderType,
    headerText: t.headerText,
    body: t.body,
    footer: t.footer,
    buttons: parse<TemplateButton[]>(t.buttons, []),
    examples: parse<TemplateExamples>(t.examples, {}),
    authOptions: { ...DEFAULT_AUTH_OPTIONS, ...parse<Partial<AuthOptions>>(t.authOptions, {}) },
  };
}

const include = {
  waba: { select: { id: true, name: true, wabaId: true, isDemo: true, accounts: { where: { status: { in: ["connected", "demo"] } }, select: { id: true, displayName: true, phoneNumber: true } } } },
  createdBy: { select: { name: true, email: true } },
  _count: { select: { campaigns: true } },
} satisfies Prisma.MessageTemplateInclude;
type Row = Prisma.MessageTemplateGetPayload<{ include: typeof include }>;

export function toTemplateDto(t: Row) {
  const def = toDef(t);
  return {
    id: t.id,
    ...def,
    status: t.status as TemplateStatus,
    slots: templateSlots(def),
    metaTemplateId: t.metaTemplateId || null,
    metaStatus: t.metaStatus,
    rejectedReason: t.rejectedReason,
    qualityScore: t.qualityScore,
    source: t.source,
    isDemo: t.isDemo,
    waba: { id: t.waba.id, name: t.waba.name, isDemo: t.waba.isDemo, numbers: t.waba.accounts },
    createdBy: t.createdBy?.name || t.createdBy?.email || null,
    campaigns: t._count.campaigns,
    submittedAt: t.submittedAt,
    reviewedAt: t.reviewedAt,
    lastSyncedAt: t.lastSyncedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}
export type TemplateDto = ReturnType<typeof toTemplateDto>;

async function load(organizationId: string, id: string) {
  const t = await db.messageTemplate.findFirst({ where: { id, organizationId }, include });
  if (!t) throw new ApiError("NOT_FOUND", "Template not found.");
  return t;
}

export async function getTemplate(access: OrgAccess, id: string) {
  return toTemplateDto(await load(access.organizationId, id));
}

/** For server-rendered pages that already resolved the tenant. Null when not in this org. */
export async function findTemplate(organizationId: string, id: string) {
  const t = await db.messageTemplate.findFirst({ where: { id, organizationId }, include });
  return t ? toTemplateDto(t) : null;
}

export type TemplateFilters = { status?: string; category?: string; q?: string; wabaId?: string };

export async function listTemplates(access: OrgAccess, f: TemplateFilters = {}) {
  const base: Prisma.MessageTemplateWhereInput = {
    organizationId: access.organizationId,
    ...(f.category ? { category: f.category } : {}),
    ...(f.wabaId ? { wabaRecordId: f.wabaId } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q.toLowerCase() } }, { body: { contains: f.q } }] } : {}),
  };
  const [rows, grouped] = await Promise.all([
    db.messageTemplate.findMany({ where: { ...base, ...(f.status ? { status: f.status } : {}) }, include, orderBy: { updatedAt: "desc" }, take: 500 }),
    db.messageTemplate.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);
  const counts: Record<string, number> = { all: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.all += g._count._all;
  }
  return { templates: rows.map(toTemplateDto), counts };
}

/** WABAs the org can create templates on (each with its connected/demo numbers). */
export async function listTemplateAccounts(organizationId: string) {
  const wabas = await db.whatsAppBusinessAccount.findMany({
    where: { organizationId, accounts: { some: { status: { in: ["connected", "demo"] } } } },
    select: { id: true, name: true, isDemo: true, accounts: { where: { status: { in: ["connected", "demo"] } }, select: { id: true, displayName: true, phoneNumber: true } } },
    orderBy: { createdAt: "asc" },
  });
  return wabas;
}

export type TemplateInput = Omit<TemplateDef, never> & { wabaId: string };

function data(def: TemplateDef) {
  const auth = def.category === "AUTHENTICATION";
  return {
    name: def.name,
    language: def.language,
    category: def.category,
    headerType: auth ? "none" : def.headerType,
    headerText: auth || def.headerType !== "text" ? "" : def.headerText,
    body: auth ? "" : def.body,
    footer: auth ? "" : def.footer,
    buttons: JSON.stringify(auth ? [] : def.buttons),
    examples: JSON.stringify(def.examples ?? {}),
    authOptions: JSON.stringify(auth ? def.authOptions : {}),
  };
}

function assertDraftValid(def: TemplateDef) {
  const { errors } = validateTemplate(def);
  // Drafts may be incomplete, but never structurally impossible.
  if (Object.keys(errors).length) throw new ApiError("VALIDATION_ERROR", "Please fix the highlighted fields.", { details: errors });
}

function uniqueConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new ApiError("CONFLICT", "A template with this name and language already exists on this WhatsApp account.", { details: { name: ["Already used"] } });
  }
  throw e;
}

export async function createTemplate(access: OrgAccess, input: TemplateInput, req?: Request) {
  const waba = await db.whatsAppBusinessAccount.findFirst({ where: { id: input.wabaId, organizationId: access.organizationId, accounts: { some: { status: { in: ["connected", "demo"] } } } } });
  if (!waba) throw new ApiError("VALIDATION_ERROR", "Choose a connected WhatsApp account.", { details: { wabaId: ["Not connected"] } });
  assertDraftValid(input);
  const t = await db.messageTemplate
    .create({ data: { organizationId: access.organizationId, wabaRecordId: waba.id, isDemo: waba.isDemo, createdById: access.user.id, ...data(input) } })
    .catch(uniqueConflict);
  await audit({ action: "template.created", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "template", targetId: t.id, metadata: { name: t.name, category: t.category }, req });
  return getTemplate(access, t.id);
}

export async function updateTemplate(access: OrgAccess, id: string, input: TemplateDef, req?: Request) {
  const t = await load(access.organizationId, id);
  if (t.status !== "draft" && t.status !== "rejected") {
    throw new ApiError("CONFLICT", "Only drafts and rejected templates can be edited. Duplicate this template to make a new version.");
  }
  // A template already known to Meta keeps its name/language (Meta edits by id).
  if (t.metaTemplateId && !t.isDemo && (input.name !== t.name || input.language !== t.language)) {
    throw new ApiError("VALIDATION_ERROR", "Name and language can't change after submission to Meta.", { details: { name: ["Locked after submission"] } });
  }
  assertDraftValid(input);
  await db.messageTemplate.update({ where: { id }, data: { ...data(input), status: "draft" } }).catch(uniqueConflict);
  await audit({ action: "template.updated", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "template", targetId: id, metadata: { name: input.name }, req });
  return getTemplate(access, id);
}

export async function duplicateTemplate(access: OrgAccess, id: string, name: string, req?: Request) {
  const t = await load(access.organizationId, id);
  const def = { ...toDef(t), name };
  assertDraftValid(def);
  const copy = await db.messageTemplate
    .create({ data: { organizationId: access.organizationId, wabaRecordId: t.wabaRecordId, isDemo: t.isDemo, createdById: access.user.id, ...data(def) } })
    .catch(uniqueConflict);
  await audit({ action: "template.created", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "template", targetId: copy.id, metadata: { name, duplicatedFrom: t.name }, req });
  return getTemplate(access, copy.id);
}

/** Decrypted token of the WABA's active connection (server-only, never returned). */
export async function wabaToken(wabaRecordId: string): Promise<string> {
  const conn = await db.whatsAppConnection.findFirst({
    where: { wabaRecordId, status: "active", isDemo: false, encryptedAccessToken: { not: "" } },
    orderBy: { connectedAt: "desc" },
  });
  if (!conn) throw new ApiError("CONFLICT", "This WhatsApp account has no active connection. Reconnect it in the Connection Center.");
  return decryptSecret(conn.encryptedAccessToken);
}

export type ReviewSample = { file: Blob; filename: string; mimeType: string };

/**
 * Sends a draft to Meta for review. Demo accounts never leave MECGURA: the
 * template goes to "pending" and the review outcome is simulated explicitly.
 */
export async function submitTemplate(access: OrgAccess, id: string, sample?: ReviewSample, req?: Request) {
  const t = await load(access.organizationId, id);
  if (t.status !== "draft") throw new ApiError("CONFLICT", t.status === "rejected" ? "Edit the rejected template first, then submit it again." : "This template was already submitted.");
  const def = toDef(t);
  const { errors } = validateTemplate(def, { forSubmit: true });
  const isMediaHeader = def.category !== "AUTHENTICATION" && def.headerType !== "none" && def.headerType !== "text";
  if (isMediaHeader && !t.isDemo && !sample) (errors.headerSample ??= []).push(`Attach a sample ${def.headerType} — Meta needs it to review the header.`);
  if (Object.keys(errors).length) throw new ApiError("VALIDATION_ERROR", "This template isn't ready for review yet.", { details: errors });

  const now = new Date();
  if (t.isDemo) {
    await db.messageTemplate.update({
      where: { id },
      data: { status: "pending", metaStatus: "PENDING", metaTemplateId: t.metaTemplateId || `DEMO-TPL-${randomUUID().slice(0, 8).toUpperCase()}`, rejectedReason: "", submittedAt: now },
    });
  } else {
    const waba = await db.whatsAppBusinessAccount.findUniqueOrThrow({ where: { id: t.wabaRecordId } });
    const token = await wabaToken(t.wabaRecordId);
    try {
      const handle = isMediaHeader && sample ? await uploadReviewSample(token, sample.file, sample.filename, sample.mimeType) : undefined;
      const components = toMetaComponents(def, handle);
      const r = t.metaTemplateId
        ? // Rejected templates are corrected in place on Meta.
          { ...(await graph<{ success?: boolean }>(t.metaTemplateId, { token, method: "POST", body: { category: def.category, components }, timeoutMs: 30_000 })), id: t.metaTemplateId, status: "PENDING", category: def.category }
        : await metaCreate(waba.wabaId, token, { name: def.name, language: def.language, category: def.category, components });
      const status = mapMetaStatus(r.status ?? "PENDING");
      await db.messageTemplate.update({
        where: { id },
        data: {
          status,
          metaStatus: r.status ?? "PENDING",
          metaTemplateId: r.id,
          rejectedReason: "",
          submittedAt: now,
          ...(r.category && r.category !== def.category ? { category: r.category } : {}),
          ...(status !== "pending" ? { reviewedAt: now } : {}),
        },
      });
    } catch (e) {
      if (e instanceof MetaApiError) throw new ApiError("VALIDATION_ERROR", `Meta didn't accept the template: ${e.message}`);
      throw e;
    }
  }
  await audit({ action: "template.submitted", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "template", targetId: id, metadata: { name: t.name, demo: t.isDemo }, req });
  return getTemplate(access, id);
}

/** Demo only: stands in for Meta's review decision so the full flow can be exercised. */
export async function simulateReview(access: OrgAccess, id: string, decision: "approved" | "rejected", reason: string, req?: Request) {
  const t = await load(access.organizationId, id);
  if (!t.isDemo) throw new ApiError("FORBIDDEN", "Review decisions come from Meta for live accounts.");
  if (t.status !== "pending") throw new ApiError("CONFLICT", "Only templates pending review can be approved or rejected.");
  await setReviewStatus(t, decision === "approved" ? "APPROVED" : "REJECTED", decision === "rejected" ? reason || "Rejected in demo review" : "", access.user.id, req);
  return getTemplate(access, id);
}

async function setReviewStatus(t: MessageTemplate, metaStatus: string, reason: string, actorUserId: string | null, req?: Request) {
  const status = mapMetaStatus(metaStatus);
  if (status === t.status && metaStatus === t.metaStatus) return;
  await db.messageTemplate.update({
    where: { id: t.id },
    data: { status, metaStatus, rejectedReason: status === "rejected" || status === "disabled" || status === "paused" ? reason : "", reviewedAt: new Date() },
  });
  publish(t.organizationId, { type: "template.updated", templateId: t.id });
  await audit({
    action: "template.status_changed",
    organizationId: t.organizationId,
    actorUserId,
    targetType: "template",
    targetId: t.id,
    metadata: { name: t.name, from: t.status, to: status, reason: reason || undefined, source: actorUserId ? "demo_review" : "meta_webhook" },
    req,
  });
}

export async function deleteTemplate(access: OrgAccess, id: string, req?: Request) {
  const t = await load(access.organizationId, id);
  const active = await db.campaign.count({ where: { templateId: id, status: { in: ["scheduled", "sending", "paused"] } } });
  if (active) throw new ApiError("CONFLICT", "A scheduled or running campaign uses this template. Cancel it first.");
  if (t.metaTemplateId && !t.isDemo) {
    const waba = await db.whatsAppBusinessAccount.findUniqueOrThrow({ where: { id: t.wabaRecordId } });
    try {
      await metaDelete(waba.wabaId, await wabaToken(t.wabaRecordId), t.name, t.metaTemplateId);
    } catch (e) {
      if (e instanceof MetaApiError) throw new ApiError("CONFLICT", `Meta couldn't delete the template: ${e.message}`);
      throw e;
    }
  }
  await db.messageTemplate.delete({ where: { id } });
  await audit({ action: "template.deleted", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "template", targetId: id, metadata: { name: t.name }, req });
}

/** Imports/refreshes every template on a live WABA from Meta (status, quality, content). */
export async function syncTemplates(access: OrgAccess, wabaRecordId: string, req?: Request) {
  const waba = await db.whatsAppBusinessAccount.findFirst({ where: { id: wabaRecordId, organizationId: access.organizationId } });
  if (!waba) throw new ApiError("NOT_FOUND", "WhatsApp account not found.");
  if (waba.isDemo) throw new ApiError("CONFLICT", "Demo accounts have no templates on Meta to sync.");
  let remote;
  try {
    remote = await metaList(waba.wabaId, await wabaToken(waba.id));
  } catch (e) {
    if (e instanceof MetaApiError) throw new ApiError("CONFLICT", `Couldn't load templates from Meta: ${e.message}`);
    throw e;
  }
  const now = new Date();
  let created = 0;
  let updated = 0;
  for (const m of remote) {
    const def = fromMetaComponents(m.category, (m.components ?? []) as Parameters<typeof fromMetaComponents>[1]);
    const status = mapMetaStatus(m.status);
    const fields = {
      ...data({ ...def, name: m.name, language: m.language }),
      status,
      metaStatus: m.status,
      metaTemplateId: m.id,
      rejectedReason: m.rejected_reason && m.rejected_reason !== "NONE" ? m.rejected_reason : "",
      qualityScore: m.quality_score?.score ?? "UNKNOWN",
      lastSyncedAt: now,
    };
    const existing = await db.messageTemplate.findUnique({ where: { wabaRecordId_name_language: { wabaRecordId: waba.id, name: m.name, language: m.language } } });
    if (existing) {
      await db.messageTemplate.update({ where: { id: existing.id }, data: fields });
      updated++;
    } else {
      await db.messageTemplate.create({ data: { organizationId: access.organizationId, wabaRecordId: waba.id, source: "meta_sync", createdById: access.user.id, ...fields } });
      created++;
    }
  }
  await audit({ action: "templates.synced", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "waba", targetId: waba.id, metadata: { created, updated }, req });
  return { created, updated, total: remote.length };
}

// ---------------------------------------------------------------------------
// Webhooks (message_template_status_update / quality / category)
// ---------------------------------------------------------------------------

export type TemplateWebhookEvent =
  | { type: "status"; metaTemplateId: string; name: string; language: string; event: string; reason: string }
  | { type: "quality"; metaTemplateId: string; score: string }
  | { type: "category"; metaTemplateId: string; category: string };

export async function applyTemplateWebhook(organizationId: string, wabaRecordId: string, ev: TemplateWebhookEvent): Promise<boolean> {
  const t =
    (await db.messageTemplate.findFirst({ where: { organizationId, wabaRecordId, metaTemplateId: ev.metaTemplateId } })) ??
    (ev.type === "status" ? await db.messageTemplate.findFirst({ where: { organizationId, wabaRecordId, name: ev.name, language: ev.language } }) : null);
  if (!t) return false;
  if (ev.type === "status") {
    if (!t.metaTemplateId) await db.messageTemplate.update({ where: { id: t.id }, data: { metaTemplateId: ev.metaTemplateId } });
    await setReviewStatus(t, ev.event, ev.reason && ev.reason !== "NONE" ? ev.reason : "", null);
  } else if (ev.type === "quality") {
    await db.messageTemplate.update({ where: { id: t.id }, data: { qualityScore: ev.score || "UNKNOWN" } });
  } else if ((["MARKETING", "UTILITY", "AUTHENTICATION"] as string[]).includes(ev.category) && ev.category !== t.category) {
    await db.messageTemplate.update({ where: { id: t.id }, data: { category: ev.category } });
    await audit({ action: "template.status_changed", organizationId, targetType: "template", targetId: t.id, metadata: { name: t.name, category: `${t.category} → ${ev.category}`, source: "meta_webhook" } });
  }
  return true;
}

/** Approved template by id or name+language on the account's WABA — used by inbox sends and campaigns. */
export async function requireApprovedTemplate(organizationId: string, wabaRecordId: string | null, ref: { templateId?: string; name?: string; language?: string }) {
  const t = ref.templateId
    ? await db.messageTemplate.findFirst({ where: { id: ref.templateId, organizationId } })
    : wabaRecordId && ref.name && ref.language
      ? await db.messageTemplate.findFirst({ where: { organizationId, wabaRecordId, name: ref.name, language: ref.language } })
      : null;
  if (!t) throw new ApiError("VALIDATION_ERROR", "Choose an approved template from your template library.", { details: { templateName: ["Not in your template library"] } });
  if (wabaRecordId && t.wabaRecordId !== wabaRecordId) throw new ApiError("VALIDATION_ERROR", "This template belongs to a different WhatsApp account.");
  if (t.status !== "approved") throw new ApiError("CONFLICT", `“${t.name}” is ${t.status}. Only approved templates can be sent.`);
  return t;
}
