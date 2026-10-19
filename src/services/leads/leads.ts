import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decryptSecret, encryptSecret, isEncryptionConfigured, last4 } from "@/lib/crypto";
import { incrementUsage } from "@/lib/services/usage";
import { paramProblem, templateSlots, type SlotValues } from "@/lib/templates";
import type { OrgAccess } from "@/lib/session";
import type { VariableMapping } from "@/lib/validations";
import { MetaApiError } from "@/providers/meta/graph";
import { getLead, getPageInfo, subscribePageToLeads } from "@/providers/meta/api";
import { assertMonthlyQuota } from "@/services/billing/entitlements";
import { emitAutomationEvent } from "@/services/automations/events";
import { emitContactEvent } from "@/services/webhooks/events";
import { normalizePhone, recordConsent } from "@/services/inbox/contacts";
import { SystemSendError, sendTemplateToContact } from "@/services/inbox/messaging";
import { resolveValue } from "@/services/campaigns/compliance";
import { requireApprovedTemplate } from "@/services/templates/templates";
import { toDef } from "@/services/templates/templates";

export type LeadFields = Record<string, string>;
export type LeadSourceInput = {
  name: string;
  pageId: string;
  pageAccessToken: string;
  formId: string;
  whatsappAccountId: string;
  templateId: string | null;
  variables: Record<string, VariableMapping>;
  phoneField: string;
  nameField: string;
  emailField: string;
  consentConfirmed: boolean;
};

const toDto = (s: Awaited<ReturnType<typeof db.leadSource.findFirstOrThrow>>) => ({
  id: s.id,
  name: s.name,
  pageId: s.pageId,
  formId: s.formId,
  tokenLast4: s.tokenLast4,
  whatsappAccountId: s.whatsappAccountId,
  templateId: s.templateId,
  variables: JSON.parse(s.variables || "{}") as Record<string, VariableMapping>,
  phoneField: s.phoneField,
  nameField: s.nameField,
  emailField: s.emailField,
  consentConfirmed: s.consentConfirmed,
  status: s.status,
  leadsCount: s.leadsCount,
  lastLeadAt: s.lastLeadAt,
  createdAt: s.createdAt,
});

/** Account and template must belong to this client and the template must be approved and sendable to leads. */
async function validateTarget(organizationId: string, whatsappAccountId: string, templateId: string | null, variables: Record<string, VariableMapping>) {
  const acct = await db.whatsAppAccount.findFirst({ where: { id: whatsappAccountId, organizationId } });
  if (!acct || (acct.status !== "connected" && acct.status !== "demo")) throw new ApiError("VALIDATION_ERROR", "Choose a connected WhatsApp number.", { details: { whatsappAccountId: ["Not connected"] } });
  if (!templateId) return;
  const t = await requireApprovedTemplate(organizationId, acct.wabaRecordId, { templateId });
  if (t.category === "AUTHENTICATION") throw new ApiError("VALIDATION_ERROR", "Authentication templates can't be used for lead replies.", { details: { templateId: ["Choose a marketing or utility template"] } });
  const slots = templateSlots(toDef(t));
  const missing = slots.filter((s) => !variables[s.key]);
  if (missing.length) throw new ApiError("VALIDATION_ERROR", `Map a value for ${missing.map((s) => s.label).join(", ")}.`, { details: { variables: [`Missing: ${missing.map((s) => s.label).join(", ")}`] } });
}

export async function listLeadSources(organizationId: string) {
  return (await db.leadSource.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } })).map(toDto);
}

export async function createLeadSource(access: OrgAccess, input: LeadSourceInput, req?: Request) {
  if (!isEncryptionConfigured()) throw new ApiError("SERVICE_UNAVAILABLE", "Secure credential storage is not configured on this server yet.");
  if (!input.consentConfirmed) throw new ApiError("VALIDATION_ERROR", "Confirm that your lead form asks permission to message people on WhatsApp.", { details: { consentConfirmed: ["Required"] } });
  const orgId = access.organizationId;
  await validateTarget(orgId, input.whatsappAccountId, input.templateId, input.variables);
  if (await db.leadSource.findUnique({ where: { pageId: input.pageId }, select: { id: true } })) throw new ApiError("CONFLICT", "This Facebook Page is already connected to a workspace.", { details: { pageId: ["Already connected"] } });
  let pageName = "";
  let subscribed = false;
  try {
    pageName = (await getPageInfo(input.pageId, input.pageAccessToken)).name ?? "";
    subscribed = await subscribePageToLeads(input.pageId, input.pageAccessToken).catch(() => false);
  } catch (e) {
    throw new ApiError("VALIDATION_ERROR", e instanceof MetaApiError ? `Meta couldn't verify this Page: ${e.message}` : "Couldn't verify the Page with Meta. Try again.");
  }
  const s = await db.leadSource.create({
    data: {
      organizationId: orgId,
      name: input.name || pageName || "Lead form",
      pageId: input.pageId,
      formId: input.formId,
      encryptedPageToken: encryptSecret(input.pageAccessToken),
      tokenLast4: last4(input.pageAccessToken),
      whatsappAccountId: input.whatsappAccountId,
      templateId: input.templateId,
      variables: JSON.stringify(input.variables),
      phoneField: input.phoneField,
      nameField: input.nameField,
      emailField: input.emailField,
      consentConfirmed: true,
      createdById: access.user.id,
    },
  });
  await audit({ action: "lead_source.connected", actorUserId: access.user.id, organizationId: orgId, targetType: "lead_source", targetId: s.id, metadata: { pageId: input.pageId, consentConfirmed: true, webhookSubscribed: subscribed }, req });
  return { source: toDto(s), webhookSubscribed: subscribed };
}

export async function updateLeadSource(access: OrgAccess, id: string, patch: Partial<Pick<LeadSourceInput, "name" | "templateId" | "variables" | "whatsappAccountId" | "phoneField" | "nameField" | "emailField">> & { status?: "active" | "paused" }) {
  const cur = await db.leadSource.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!cur) throw new ApiError("NOT_FOUND", "Lead source not found.");
  const accountId = patch.whatsappAccountId ?? cur.whatsappAccountId;
  const templateId = patch.templateId === undefined ? cur.templateId : patch.templateId;
  const variables = patch.variables ?? (JSON.parse(cur.variables || "{}") as Record<string, VariableMapping>);
  if (patch.whatsappAccountId || patch.templateId !== undefined || patch.variables) await validateTarget(access.organizationId, accountId, templateId, variables);
  const s = await db.leadSource.update({
    where: { id },
    data: {
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      whatsappAccountId: accountId,
      templateId,
      variables: JSON.stringify(variables),
      ...(patch.phoneField ? { phoneField: patch.phoneField } : {}),
      ...(patch.nameField ? { nameField: patch.nameField } : {}),
      ...(patch.emailField ? { emailField: patch.emailField } : {}),
    },
  });
  return toDto(s);
}

export async function deleteLeadSource(access: OrgAccess, id: string, req?: Request) {
  const r = await db.leadSource.deleteMany({ where: { id, organizationId: access.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Lead source not found.");
  await audit({ action: "lead_source.removed", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "lead_source", targetId: id, req });
}

export async function listLeads(organizationId: string, sourceId: string) {
  if (!(await db.leadSource.count({ where: { id: sourceId, organizationId } }))) throw new ApiError("NOT_FOUND", "Lead source not found.");
  const rows = await db.lead.findMany({ where: { sourceId, organizationId }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((l) => ({ id: l.id, status: l.status, error: l.error, isTest: l.isTest, contactId: l.contactId, createdAt: l.createdAt }));
}

const pick = (fields: LeadFields, key: string) => (fields[key] ?? "").trim();

/**
 * One submitted lead → contact (with the owner-confirmed consent) → optional WhatsApp template. Every lead leaves a Lead row,
 * so nothing is lost silently: it ends "messaged", "skipped" (no phone, opted out) or "failed" (with the reason).
 */
export async function processLead(sourceId: string, fields: LeadFields, meta: { leadgenId: string; formId: string; isTest: boolean }) {
  const source = await db.leadSource.findUniqueOrThrow({ where: { id: sourceId } });
  const orgId = source.organizationId;
  let lead;
  try {
    lead = await db.lead.create({ data: { organizationId: orgId, sourceId, leadgenId: meta.leadgenId, formId: meta.formId, isTest: meta.isTest } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: "duplicate" as const };
    throw e;
  }
  const finish = async (status: "messaged" | "skipped" | "failed", error = "", contactId: string | null = null) => {
    await db.lead.update({ where: { id: lead.id }, data: { status, error: error.slice(0, 300), contactId } });
    if (!meta.isTest) await db.leadSource.update({ where: { id: sourceId }, data: { leadsCount: { increment: 1 }, lastLeadAt: new Date() } });
    return { status, error, contactId };
  };

  const phone = normalizePhone(pick(fields, source.phoneField));
  if (!phone) return finish("skipped", "The lead has no valid phone number.");
  const name = pick(fields, source.nameField).slice(0, 120);
  const email = pick(fields, source.emailField).slice(0, 200);

  let contact = await db.contact.findUnique({ where: { organizationId_phone: { organizationId: orgId, phone } } });
  try {
    if (!contact) {
      await assertMonthlyQuota(orgId, "contacts", 1, "new contacts");
      contact = await db.contact.create({ data: { organizationId: orgId, phone, name, email, source: "meta_lead_ad", lifecycle: "lead", leadStatus: "new" } });
      await incrementUsage(orgId, "contacts_created");
      await audit({ action: "contact.created", organizationId: orgId, targetType: "contact", targetId: contact.id, metadata: { source: "meta_lead_ad" } });
      await emitAutomationEvent(orgId, { type: "new_contact", contactId: contact.id, source: "meta_lead_ad" });
      await emitContactEvent("contact.created", orgId, contact.id);
    } else if ((!contact.name && name) || (!contact.email && email)) {
      contact = await db.contact.update({ where: { id: contact.id }, data: { ...(!contact.name && name ? { name } : {}), ...(!contact.email && email ? { email } : {}) } });
    }
  } catch (e) {
    return finish("failed", e instanceof ApiError ? e.message : "Couldn't save the contact.");
  }

  if (contact.suppressed || contact.optInStatus === "opted_out") return finish("skipped", "The contact opted out or is suppressed.", contact.id);
  if (contact.optInStatus !== "opted_in" && source.consentConfirmed) {
    await recordConsent({ organizationId: orgId, actorUserId: null }, contact.id, { status: "opted_in", source: "lead_form", evidence: `Meta Lead Ad form ${meta.formId || "(any)"}, lead ${meta.leadgenId}${meta.isTest ? " (test)" : ""}` });
  }
  if (!source.templateId) return finish("skipped", "No reply template is set. The lead was saved as a contact.", contact.id);

  try {
    const t = await requireApprovedTemplate(orgId, null, { templateId: source.templateId });
    const mapping = JSON.parse(source.variables || "{}") as Record<string, VariableMapping>;
    const ct = { name: contact.name, phone: contact.phone, email: contact.email, customFields: contact.customFields };
    const values: SlotValues = {};
    for (const s of templateSlots(toDef(t))) {
      values[s.key] = resolveValue(mapping[s.key], ct);
      const problem = paramProblem(values[s.key], s.part === "header" && s.kind === "media" ? "media" : "text");
      if (problem) return finish("failed", `${s.label}: ${problem}`, contact.id);
    }
    await sendTemplateToContact(orgId, source.whatsappAccountId, contact.id, source.templateId, values, { origin: "lead_ad", leadSourceId: source.id });
    return finish("messaged", "", contact.id);
  } catch (e) {
    return finish("failed", e instanceof SystemSendError || e instanceof ApiError ? e.message : "The reply couldn't be sent.", contact.id);
  }
}

/** Test button: runs the full pipeline with made-up form answers, so setup can be verified without waiting for a real lead. */
export async function sendTestLead(access: OrgAccess, sourceId: string, input: { phone: string; name: string }) {
  const s = await db.leadSource.findFirst({ where: { id: sourceId, organizationId: access.organizationId } });
  if (!s) throw new ApiError("NOT_FOUND", "Lead source not found.");
  const fields: LeadFields = { [s.phoneField]: input.phone, [s.nameField]: input.name, [s.emailField]: "" };
  return processLead(s.id, fields, { leadgenId: `test-${s.id}-${Date.now()}`, formId: s.formId, isTest: true });
}

/** Webhook entry for a real submission: fetch the lead with the Page token, then process it. */
export async function handleLeadgen(pageId: string, leadgenId: string, formId: string): Promise<"ignored" | "duplicate" | "processed" | "failed"> {
  const source = await db.leadSource.findUnique({ where: { pageId } });
  if (!source || source.status !== "active") return "ignored";
  if (source.formId && formId && source.formId !== formId) return "ignored";
  if (await db.lead.count({ where: { leadgenId } })) return "duplicate";
  let fields: LeadFields = {};
  try {
    const lead = await getLead(leadgenId, decryptSecret(source.encryptedPageToken));
    fields = Object.fromEntries((lead.field_data ?? []).map((f) => [f.name, (f.values ?? [])[0] ?? ""]));
  } catch (e) {
    // The lead can't be read (token expired, permission missing). Keep a failed row so it's visible, and let Meta retry.
    const msg = e instanceof MetaApiError ? e.message : "Couldn't read the lead from Meta.";
    await db.lead.create({ data: { organizationId: source.organizationId, sourceId: source.id, leadgenId, formId, status: "failed", error: msg.slice(0, 300) } }).catch(() => undefined);
    return "failed";
  }
  const r = await processLead(source.id, fields, { leadgenId, formId, isTest: false });
  return r.status === "duplicate" ? "duplicate" : "processed";
}
