import { randomUUID } from "node:crypto";
import { assertFeature } from "@/services/billing/entitlements";
import { Prisma, type Flow } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime/broker";
import type { OrgAccess } from "@/lib/session";
import { FLOW_TEMPLATES, allFields, answerText, blankDefinition, normalizeAnswers, summarizeAnswers, toFlowJson, validateFlow, type Answers, type FlowCategory, type FlowDefinition, type FlowTemplateKey } from "@/lib/flows";
import { flowDefinitionSchema } from "@/lib/validations";
import { MetaApiError } from "@/providers/meta/graph";
import { createFlow, deleteDraftFlow, deprecateFlow, publishFlow, updateFlowJson } from "@/providers/meta/flows";
import { wabaToken } from "@/services/templates/templates";
import { addContactNote, normalizePhone, recordConsent, setContactTags, updateContact } from "@/services/inbox/contacts";
import { pickLeastBusyMember, systemAssign } from "@/services/inbox/routing";
import { emitFlowSubmitted } from "@/services/webhooks/events";
import { receiveInbound, sendSystemText, SystemSendError } from "@/services/inbox/messaging";

export function parseDefinition(raw: string): FlowDefinition {
  try {
    const r = flowDefinitionSchema.safeParse(JSON.parse(raw));
    if (r.success) return r.data as FlowDefinition;
  } catch {
    /* fall through */
  }
  return blankDefinition();
}

const include = {
  waba: { select: { id: true, name: true, isDemo: true, accounts: { where: { status: { in: ["connected", "demo"] } }, select: { id: true, displayName: true, phoneNumber: true } } } },
  _count: { select: { submissions: true } },
} satisfies Prisma.FlowInclude;
type Row = Prisma.FlowGetPayload<{ include: typeof include }>;

function toDto(f: Row) {
  return {
    id: f.id,
    name: f.name,
    category: f.category as FlowCategory,
    template: f.template,
    status: f.status,
    definition: parseDefinition(f.definition),
    metaFlowId: f.metaFlowId || null,
    metaStatus: f.metaStatus,
    validationErrors: JSON.parse(f.validationErrors || "[]") as string[],
    isDemo: f.isDemo,
    wabaId: f.wabaRecordId,
    waba: f.waba,
    submissions: f._count.submissions,
    publishedAt: f.publishedAt,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}
export type FlowDto = ReturnType<typeof toDto>;

async function load(organizationId: string, id: string) {
  const f = await db.flow.findFirst({ where: { id, organizationId }, include });
  if (!f) throw new ApiError("NOT_FOUND", "Flow not found.");
  return f;
}

export async function getFlow(organizationId: string, id: string) {
  return toDto(await load(organizationId, id));
}

export async function listFlows(organizationId: string, f: { status?: string; q?: string }) {
  const base: Prisma.FlowWhereInput = { organizationId, ...(f.q ? { name: { contains: f.q } } : {}) };
  const [rows, grouped, wabas] = await Promise.all([
    db.flow.findMany({ where: { ...base, ...(f.status ? { status: f.status } : {}) }, include, orderBy: { updatedAt: "desc" }, take: 200 }),
    db.flow.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    db.whatsAppBusinessAccount.findMany({
      where: { organizationId, accounts: { some: { status: { in: ["connected", "demo"] } } } },
      select: { id: true, name: true, isDemo: true, accounts: { where: { status: { in: ["connected", "demo"] } }, select: { id: true, displayName: true, phoneNumber: true } } },
    }),
  ]);
  const counts: Record<string, number> = { all: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.all += g._count._all;
  }
  return { flows: rows.map(toDto), counts, accounts: wabas };
}

function uniqueName(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ApiError("CONFLICT", "A Flow with this name already exists.", { details: { name: ["Already used"] } });
  throw e;
}

export async function createFlowRecord(access: OrgAccess, input: { name: string; wabaId: string; template: FlowTemplateKey | "custom" }, req?: Request) {
  await assertFeature(access.organizationId, "flows");
  const waba = await db.whatsAppBusinessAccount.findFirst({ where: { id: input.wabaId, organizationId: access.organizationId, accounts: { some: { status: { in: ["connected", "demo"] } } } } });
  if (!waba) throw new ApiError("VALIDATION_ERROR", "Choose a connected WhatsApp account.", { details: { wabaId: ["Not connected"] } });
  const tpl = input.template === "custom" ? null : FLOW_TEMPLATES[input.template];
  const f = await db.flow
    .create({
      data: {
        organizationId: access.organizationId,
        wabaRecordId: waba.id,
        isDemo: waba.isDemo,
        name: input.name,
        category: tpl?.category ?? "OTHER",
        template: input.template,
        definition: JSON.stringify(tpl?.definition ?? blankDefinition()),
        createdById: access.user.id,
      },
    })
    .catch(uniqueName);
  await audit({ action: "flow.created", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "flow", targetId: f.id, metadata: { name: f.name, template: input.template }, req });
  return getFlow(access.organizationId, f.id);
}

export async function updateFlowRecord(access: OrgAccess, id: string, p: { name?: string; category?: FlowCategory; definition?: FlowDefinition }, req?: Request) {
  const f = await load(access.organizationId, id);
  if (f.status !== "draft") throw new ApiError("CONFLICT", "Published Flows can't be changed (Meta locks them). Duplicate it to make a new version.");
  await db.flow
    .update({ where: { id }, data: { ...(p.name ? { name: p.name } : {}), ...(p.category ? { category: p.category } : {}), ...(p.definition ? { definition: JSON.stringify(p.definition) } : {}) } })
    .catch(uniqueName);
  await audit({ action: "flow.updated", organizationId: f.organizationId, actorUserId: access.user.id, targetType: "flow", targetId: id, metadata: { name: p.name ?? f.name }, req });
  return getFlow(access.organizationId, id);
}

export async function duplicateFlow(access: OrgAccess, id: string, req?: Request) {
  const f = await load(access.organizationId, id);
  let name = `${f.name} (copy)`.slice(0, 60);
  for (let i = 2; await db.flow.count({ where: { organizationId: f.organizationId, name } }); i++) name = `${f.name} (copy ${i})`.slice(0, 60);
  const copy = await db.flow.create({
    data: { organizationId: f.organizationId, wabaRecordId: f.wabaRecordId, isDemo: f.isDemo, name, category: f.category, template: f.template, definition: f.definition, createdById: access.user.id },
  });
  await audit({ action: "flow.created", organizationId: f.organizationId, actorUserId: access.user.id, targetType: "flow", targetId: copy.id, metadata: { name, duplicatedFrom: f.name }, req });
  return getFlow(access.organizationId, copy.id);
}

/** Validates, generates Flow JSON and publishes — to Meta for live accounts, locally (clearly marked) for demo ones. */
export async function publishFlowRecord(access: OrgAccess, id: string, req?: Request) {
  const f = await load(access.organizationId, id);
  if (f.status !== "draft") throw new ApiError("CONFLICT", "This Flow is already published.");
  const def = parseDefinition(f.definition);
  const errors = validateFlow(def);
  if (errors.length) throw new ApiError("VALIDATION_ERROR", "Fix the Flow before publishing.", { details: { flow: errors } });
  const json = JSON.stringify(toFlowJson(def));
  let metaFlowId = f.metaFlowId;
  let metaStatus = "PUBLISHED";
  if (f.isDemo) {
    metaFlowId ||= `DEMO-FLOW-${randomUUID().slice(0, 8).toUpperCase()}`;
    metaStatus = "PUBLISHED (demo — not on Meta)";
  } else {
    if (!f.wabaRecordId) throw new ApiError("CONFLICT", "This Flow has no WhatsApp account.");
    const waba = await db.whatsAppBusinessAccount.findUniqueOrThrow({ where: { id: f.wabaRecordId } });
    const token = await wabaToken(waba.id);
    try {
      const res = metaFlowId ? await updateFlowJson(metaFlowId, token, json) : await createFlow(waba.wabaId, token, { name: f.name, category: f.category, flowJson: json });
      const createdId = (res as { id?: string }).id;
      if (createdId) metaFlowId = createdId;
      const v = (res.validation_errors ?? []).map((e) => e.message ?? e.error ?? "Invalid Flow JSON");
      if (v.length) {
        await db.flow.update({ where: { id }, data: { metaFlowId, validationErrors: JSON.stringify(v), metaStatus: "DRAFT" } });
        throw new ApiError("VALIDATION_ERROR", "Meta found problems in the Flow.", { details: { flow: v } });
      }
      await publishFlow(metaFlowId, token);
    } catch (e) {
      if (e instanceof MetaApiError) {
        if (metaFlowId) await db.flow.update({ where: { id }, data: { metaFlowId } });
        throw new ApiError("VALIDATION_ERROR", `Meta didn't publish the Flow: ${e.message}`);
      }
      throw e;
    }
  }
  await db.flow.update({ where: { id }, data: { status: "published", metaFlowId, metaStatus, flowJson: json, validationErrors: "[]", publishedAt: new Date() } });
  await audit({ action: "flow.published", organizationId: f.organizationId, actorUserId: access.user.id, targetType: "flow", targetId: id, metadata: { name: f.name, demo: f.isDemo }, req });
  return getFlow(access.organizationId, id);
}

export async function deprecateFlowRecord(access: OrgAccess, id: string, req?: Request) {
  const f = await load(access.organizationId, id);
  if (f.status !== "published") throw new ApiError("CONFLICT", "Only published Flows can be retired.");
  if (!f.isDemo && f.metaFlowId && f.wabaRecordId) {
    try {
      await deprecateFlow(f.metaFlowId, await wabaToken(f.wabaRecordId));
    } catch (e) {
      if (e instanceof MetaApiError) throw new ApiError("CONFLICT", `Meta couldn't retire the Flow: ${e.message}`);
      throw e;
    }
  }
  await db.flow.update({ where: { id }, data: { status: "deprecated", metaStatus: f.isDemo ? "DEPRECATED (demo)" : "DEPRECATED" } });
  await audit({ action: "flow.deprecated", organizationId: f.organizationId, actorUserId: access.user.id, targetType: "flow", targetId: id, metadata: { name: f.name }, req });
  return getFlow(access.organizationId, id);
}

export async function deleteFlowRecord(access: OrgAccess, id: string, req?: Request) {
  const f = await load(access.organizationId, id);
  if (f.status === "published") throw new ApiError("CONFLICT", "Retire the Flow before deleting it. Its submissions are deleted with it.");
  if (!f.isDemo && f.metaFlowId && f.wabaRecordId && f.status === "draft") {
    await deleteDraftFlow(f.metaFlowId, await wabaToken(f.wabaRecordId)).catch(() => undefined);
  }
  await db.flow.delete({ where: { id } });
  await audit({ action: "flow.deleted", organizationId: f.organizationId, actorUserId: access.user.id, targetType: "flow", targetId: id, metadata: { name: f.name }, req });
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

/** Finds the Flow a WhatsApp nfm_reply belongs to: our flow_token first, then the Flow name. */
export async function flowForReply(organizationId: string, response: Record<string, unknown>, flowName: string) {
  const token = String(response.flow_token ?? "");
  const m = /^mf\.([A-Za-z0-9_-]+)\./.exec(token);
  if (m) {
    const f = await db.flow.findFirst({ where: { id: m[1], organizationId } });
    if (f) return { flow: f, token };
  }
  const byName = flowName ? await db.flow.findFirst({ where: { organizationId, name: flowName, status: { not: "draft" } } }) : null;
  return byName ? { flow: byName, token } : null;
}

type CrmResult = { updated: string[]; tags: string[]; consent: boolean; appointmentId: string | null; assignedTo: string | null; note: boolean; thankYou: string | null; errors: string[] };

/**
 * Stores a submission (contact, answers, timestamp, flow, source) and runs the
 * Flow's CRM action: updates the contact, tags, consent, appointment, routing.
 */
export async function processSubmission(input: { flow: Flow; contactId: string; conversationId: string | null; messageId: string | null; raw: Record<string, unknown>; source: "whatsapp" | "demo"; flowToken: string }) {
  const { flow } = input;
  const orgId = flow.organizationId;
  const def = parseDefinition(flow.definition);
  const { answers } = normalizeAnswers(def, input.raw);
  const result: CrmResult = { updated: [], tags: [], consent: false, appointmentId: null, assignedTo: null, note: false, thankYou: null, errors: [] };
  const ctx = { organizationId: orgId, actorUserId: null };
  const sub = await db.flowSubmission.create({
    data: { organizationId: orgId, flowId: flow.id, contactId: input.contactId, conversationId: input.conversationId, messageId: input.messageId, answers: JSON.stringify(answers), source: input.source, flowToken: input.flowToken },
  });
  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      result.errors.push(`${label}: ${e instanceof Error ? e.message : "failed"}`);
    }
  };
  const contact = await db.contact.findUniqueOrThrow({ where: { id: input.contactId } });
  const fields = allFields(def);

  await step("Contact", async () => {
    const custom = JSON.parse(contact.customFields || "{}") as Record<string, string>;
    const patch: Parameters<typeof updateContact>[2] = {};
    for (const fl of fields) {
      const target = def.crm.fieldMap[fl.name] ?? "ignore";
      const v = answerText(answers[fl.name] ?? "");
      if (target === "ignore" || !v) continue;
      if (target === "name") patch.name = v.slice(0, 120);
      if (target === "email") patch.email = v.toLowerCase().slice(0, 255);
      if (target === "custom") custom[fl.name] = v.slice(0, 500);
      result.updated.push(target === "custom" ? fl.name : target);
    }
    if (result.updated.some((u) => u !== "name" && u !== "email")) patch.customFields = custom;
    if (def.crm.lifecycle) {
      patch.lifecycle = def.crm.lifecycle;
      result.updated.push("lifecycle");
    }
    if (def.crm.leadStatus) {
      patch.leadStatus = def.crm.leadStatus;
      result.updated.push("leadStatus");
    }
    if (Object.keys(patch).length) await updateContact(ctx, contact.id, patch);
  });
  if (def.crm.tags.length) {
    await step("Tags", async () => {
      const current = (await db.contactTag.findMany({ where: { contactId: contact.id }, include: { tag: true } })).map((t) => t.tag.name);
      await setContactTags(ctx, contact.id, [...current, ...def.crm.tags]);
      result.tags = def.crm.tags;
    });
  }
  if (def.crm.consentField && answers[def.crm.consentField] === true && contact.optInStatus !== "opted_in") {
    await step("Consent", async () => {
      await recordConsent(ctx, contact.id, { status: "opted_in", source: "flow", evidence: `Ticked “${fields.find((x) => x.name === def.crm.consentField)?.label}” in WhatsApp Flow “${flow.name}”` });
      result.consent = true;
    });
  }
  const ap = def.crm.appointment;
  if (ap.enabled) {
    await step("Appointment", async () => {
      const date = answerText(answers[ap.dateField] ?? "");
      const time = ap.timeField ? answerText(answers[ap.timeField] ?? "") : "";
      const appt = await db.appointment.create({
        data: { organizationId: orgId, contactId: contact.id, conversationId: input.conversationId, service: ap.serviceField ? answerText(answers[ap.serviceField] ?? "") : "", requestedFor: [date, time].filter(Boolean).join(" · "), source: "flow", notes: `From WhatsApp Flow “${flow.name}”` },
      });
      result.appointmentId = appt.id;
      await audit({ action: "appointment.created", organizationId: orgId, targetType: "appointment", targetId: appt.id, metadata: { source: "flow", flow: flow.name } });
    });
  }
  if (def.crm.addNote) {
    await step("Note", async () => {
      await addContactNote(ctx, contact.id, `📋 WhatsApp Flow “${flow.name}” (${input.source === "demo" ? "demo" : "WhatsApp"})\n${summarizeAnswers(def, answers)}`);
      result.note = true;
    });
  }
  if (def.crm.assign === "auto" && input.conversationId) {
    await step("Assign", async () => {
      const conv = await db.conversation.findUnique({ where: { id: input.conversationId! } });
      if (conv?.assignedToUserId) return; // already with someone
      const uid = await pickLeastBusyMember(orgId);
      if (!uid) throw new Error("no agents to assign to");
      result.assignedTo = (await systemAssign(orgId, input.conversationId!, uid, `WhatsApp Flow “${flow.name}”`, `Submitted ${flow.name}`)).name;
    });
  }
  if (def.submit.thankYou.trim() && input.conversationId) {
    await step("Thank-you message", async () => {
      try {
        await sendSystemText(orgId, input.conversationId!, def.submit.thankYou, { flowId: flow.id, flowName: flow.name });
        result.thankYou = def.submit.thankYou;
      } catch (e) {
        throw new Error(e instanceof SystemSendError ? e.message : "not sent");
      }
    });
  }
  await db.flowSubmission.update({ where: { id: sub.id }, data: { crmResult: JSON.stringify(result) } });
  await audit({ action: "flow.submitted", organizationId: orgId, targetType: "flow", targetId: flow.id, metadata: { submissionId: sub.id, source: input.source, contactId: contact.id, errors: result.errors.length } });
  publish(orgId, { type: "contact.updated", contactId: contact.id });
  await emitFlowSubmitted(orgId, sub.id);
  return { submissionId: sub.id, answers, result };
}

/**
 * Demo only: answers the Flow as a customer would, delivered as an inbound
 * WhatsApp "nfm_reply" through the same code path a real submission uses.
 */
export async function simulateSubmission(access: OrgAccess, flowId: string, input: { phone: string; name: string; answers: Answers }) {
  const f = await load(access.organizationId, flowId);
  if (!f.isDemo) throw new ApiError("FORBIDDEN", "Live Flows are filled in on WhatsApp — demo submissions are for demo accounts only.");
  if (f.status !== "published") throw new ApiError("CONFLICT", "Publish the Flow first.");
  const def = parseDefinition(f.definition);
  const check = normalizeAnswers(def, input.answers);
  if (check.errors.length) throw new ApiError("VALIDATION_ERROR", "Some answers are missing or invalid.", { details: { answers: check.errors } });
  const account = await db.whatsAppAccount.findFirst({ where: { organizationId: access.organizationId, wabaRecordId: f.wabaRecordId, status: "demo" } });
  if (!account) throw new ApiError("CONFLICT", "The Flow's demo number is not connected.");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new ApiError("VALIDATION_ERROR", "Enter a valid phone number.", { details: { phone: ["Invalid"] } });
  const token = `mf.${f.id}.${randomUUID().slice(0, 8)}`;
  const r = await receiveInbound(access.organizationId, account.id, {
    externalId: `demo.flow.${randomUUID()}`,
    fromPhone: phone,
    profileName: input.name,
    type: "flow",
    body: "Form submitted",
    payload: { flowName: f.name, response: { ...input.answers, flow_token: token }, demo: true },
    at: new Date(),
    isDemo: true,
  });
  const sub = await db.flowSubmission.findFirst({ where: { flowId: f.id, flowToken: token }, orderBy: { createdAt: "desc" } });
  return { conversationId: r?.conversationId ?? null, contactId: r?.contactId ?? null, submissionId: sub?.id ?? null };
}

export async function listSubmissions(organizationId: string, flowId: string, page: number) {
  const f = await load(organizationId, flowId);
  const PAGE = 25;
  const [rows, total] = await Promise.all([
    db.flowSubmission.findMany({ where: { flowId: f.id }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { contact: { select: { id: true, name: true, phone: true } } } }),
    db.flowSubmission.count({ where: { flowId: f.id } }),
  ]);
  return {
    submissions: rows.map((s) => ({ id: s.id, contact: s.contact, answers: JSON.parse(s.answers) as Answers, source: s.source, crmResult: JSON.parse(s.crmResult) as Partial<CrmResult>, conversationId: s.conversationId, createdAt: s.createdAt })),
    total,
    page,
    pageSize: PAGE,
  };
}

const csvCell = (v: string) => {
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function exportSubmissionsCsv(organizationId: string, flowId: string) {
  const f = await load(organizationId, flowId);
  const def = parseDefinition(f.definition);
  const fields = allFields(def);
  const rows = await db.flowSubmission.findMany({ where: { flowId: f.id }, orderBy: { createdAt: "desc" }, take: 10_000, include: { contact: { select: { name: true, phone: true } } } });
  const header = ["submitted_at", "contact_name", "phone", "source", ...fields.map((x) => x.name)];
  const lines = rows.map((r) => {
    const a = JSON.parse(r.answers) as Answers;
    return [r.createdAt.toISOString(), r.contact?.name ?? "", r.contact?.phone ?? "", r.source, ...fields.map((x) => answerText(a[x.name] ?? ""))].map(csvCell).join(",");
  });
  return { filename: `${f.name.replace(/[^\w-]+/g, "_")}-submissions.csv`, csv: `﻿${[header.join(","), ...lines].join("\n")}` };
}
