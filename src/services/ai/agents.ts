import { Prisma, type AiAgent } from "@prisma/client";
import { assertFeature } from "@/services/billing/entitlements";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { OrgAccess } from "@/lib/session";
import { aiConfigured } from "@/providers/anthropic/reply";
import { DEFAULT_ACTIONS, DEFAULT_HANDOFF, DEFAULT_KNOWLEDGE, parseJson, type AgentConfig, type AiActionsConfig, type AiHandoffConfig, type AiKnowledge } from "@/lib/ai";
import type { z } from "zod";
import type { aiAgentSchema } from "@/lib/validations";

type AgentInput = z.infer<typeof aiAgentSchema>;

export const MAX_DOCUMENTS = 20;
export const MAX_DOCUMENT_BYTES = 200_000;
export const DOC_TYPES: Record<string, string> = { "text/plain": "txt", "text/markdown": "md", "text/csv": "csv" };

const include = {
  documents: { select: { id: true, name: true, mimeType: true, sizeBytes: true, createdAt: true }, orderBy: { createdAt: "asc" } },
  _count: { select: { interactions: true } },
} satisfies Prisma.AiAgentInclude;
type Row = Prisma.AiAgentGetPayload<{ include: typeof include }>;

export function agentParts(a: Pick<AiAgent, "accountIds" | "knowledge" | "actions" | "handoff">) {
  return {
    accountIds: (() => {
      try {
        const v = JSON.parse(a.accountIds) as unknown;
        return Array.isArray(v) ? v.map(String) : [];
      } catch {
        return [];
      }
    })(),
    knowledge: parseJson<AiKnowledge>(a.knowledge, DEFAULT_KNOWLEDGE),
    actions: parseJson<AiActionsConfig>(a.actions, DEFAULT_ACTIONS),
    handoff: parseJson<AiHandoffConfig>(a.handoff, DEFAULT_HANDOFF),
  };
}

function toDto(a: Row) {
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    instructions: a.instructions,
    ...agentParts(a),
    documents: a.documents,
    interactions: a._count.interactions,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}
export type AgentDto = ReturnType<typeof toDto>;

/** Loads everything the engines need: settings, documents' text and the business name. */
export async function agentConfig(agent: AiAgent): Promise<AgentConfig> {
  const [docs, org] = await Promise.all([
    db.aiDocument.findMany({ where: { agentId: agent.id }, select: { name: true, content: true }, orderBy: { createdAt: "asc" } }),
    db.organization.findUnique({ where: { id: agent.organizationId }, select: { name: true } }),
  ]);
  const p = agentParts(agent);
  return { name: agent.name, businessName: org?.name ?? "", instructions: agent.instructions, knowledge: p.knowledge, actions: p.actions, handoff: p.handoff, documents: docs };
}

async function load(organizationId: string, id: string) {
  const a = await db.aiAgent.findFirst({ where: { id, organizationId }, include });
  if (!a) throw new ApiError("NOT_FOUND", "AI agent not found.");
  return a;
}

export async function getAgent(organizationId: string, id: string) {
  return toDto(await load(organizationId, id));
}

async function numbers(organizationId: string) {
  return db.whatsAppAccount.findMany({
    where: { organizationId, status: { in: ["connected", "demo"] } },
    select: { id: true, displayName: true, phoneNumber: true, isDemo: true },
    orderBy: { createdAt: "asc" },
  });
}

/** Overview for the /ai page: agents, numbers and which mode each number would run in. */
export async function listAgents(organizationId: string) {
  const [rows, accounts, members] = await Promise.all([
    db.aiAgent.findMany({ where: { organizationId }, include, orderBy: { createdAt: "asc" } }),
    numbers(organizationId),
    db.organizationMember.findMany({ where: { organizationId, user: { status: "active" } }, select: { userId: true, role: true, user: { select: { name: true, email: true } } } }),
  ]);
  return {
    agents: rows.map(toDto),
    accounts,
    members: members.map((m) => ({ id: m.userId, name: m.user.name ?? m.user.email, role: m.role })),
    liveConfigured: aiConfigured(),
  };
}

async function validAccounts(organizationId: string, ids: string[]) {
  if (!ids.length) return [];
  const found = await db.whatsAppAccount.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true } });
  if (found.length !== new Set(ids).size) throw new ApiError("VALIDATION_ERROR", "Choose WhatsApp numbers from this workspace.", { details: { accountIds: ["Unknown number"] } });
  return [...new Set(ids)];
}

async function validHandoff(organizationId: string, h: AiHandoffConfig) {
  if (h.assign !== "user") return { ...h, userId: "" };
  const m = h.userId ? await db.organizationMember.findFirst({ where: { organizationId, userId: h.userId, user: { status: "active" } } }) : null;
  if (!m) throw new ApiError("VALIDATION_ERROR", "Choose an active team member to receive handoffs.", { details: { "handoff.userId": ["Not an active team member"] } });
  return h;
}

export async function createAgent(access: OrgAccess, input: AgentInput, req?: Request) {
  await assertFeature(access.organizationId, "ai_agent");
  const orgId = access.organizationId;
  const accountIds = await validAccounts(orgId, input.accountIds);
  const handoff = await validHandoff(orgId, input.handoff as AiHandoffConfig);
  const a = await db.aiAgent.create({
    data: {
      organizationId: orgId,
      name: input.name,
      status: "draft",
      accountIds: JSON.stringify(accountIds),
      instructions: input.instructions,
      knowledge: JSON.stringify(input.knowledge),
      actions: JSON.stringify(input.actions),
      handoff: JSON.stringify(handoff),
      createdById: access.user.id,
    },
  });
  await audit({ action: "ai_agent.created", actorUserId: access.user.id, organizationId: orgId, targetType: "ai_agent", targetId: a.id, metadata: { name: a.name }, req });
  return getAgent(orgId, a.id);
}

export async function updateAgent(access: OrgAccess, id: string, input: Partial<AgentInput>, req?: Request) {
  const orgId = access.organizationId;
  const before = await load(orgId, id);
  const data: Prisma.AiAgentUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.instructions !== undefined) data.instructions = input.instructions;
  if (input.accountIds !== undefined) data.accountIds = JSON.stringify(await validAccounts(orgId, input.accountIds));
  if (input.knowledge !== undefined) data.knowledge = JSON.stringify(input.knowledge);
  if (input.actions !== undefined) data.actions = JSON.stringify(input.actions);
  if (input.handoff !== undefined) data.handoff = JSON.stringify(await validHandoff(orgId, input.handoff as AiHandoffConfig));
  await db.aiAgent.update({ where: { id: before.id }, data });
  if (before.status === "active" && input.accountIds !== undefined) await assertNoOverlap(orgId, id);
  await audit({ action: "ai_agent.updated", actorUserId: access.user.id, organizationId: orgId, targetType: "ai_agent", targetId: id, metadata: { fields: Object.keys(input) }, req });
  return getAgent(orgId, id);
}

/** One active agent per number, so a customer never gets two bots answering. */
async function assertNoOverlap(organizationId: string, id: string) {
  const me = await db.aiAgent.findUniqueOrThrow({ where: { id } });
  const mine = agentParts(me).accountIds;
  const others = await db.aiAgent.findMany({ where: { organizationId, status: "active", id: { not: id } } });
  for (const o of others) {
    const theirs = agentParts(o).accountIds;
    if (!mine.length || !theirs.length || mine.some((x) => theirs.includes(x))) {
      throw new ApiError("CONFLICT", `“${o.name}” is already active on ${!mine.length || !theirs.length ? "these numbers" : "one of these numbers"}. Pause it first — only one AI agent can answer a number.`);
    }
  }
}

export async function setAgentStatus(access: OrgAccess, id: string, status: "active" | "paused", req?: Request) {
  const orgId = access.organizationId;
  const a = await load(orgId, id);
  if (status === "active") {
    await assertFeature(orgId, "ai_agent");
    await assertNoOverlap(orgId, id);
  }
  await db.aiAgent.update({ where: { id: a.id }, data: { status } });
  await audit({ action: "ai_agent.status_changed", actorUserId: access.user.id, organizationId: orgId, targetType: "ai_agent", targetId: id, metadata: { from: a.status, to: status }, req });
  return getAgent(orgId, id);
}

export async function deleteAgent(access: OrgAccess, id: string, req?: Request) {
  const a = await load(access.organizationId, id);
  await db.aiAgent.delete({ where: { id: a.id } });
  await audit({ action: "ai_agent.deleted", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "ai_agent", targetId: id, metadata: { name: a.name }, req });
}

/**
 * Knowledge documents: plain text only (TXT, Markdown, CSV, or pasted text).
 * The text is stored and given to the AI; the original file isn't kept.
 */
export async function addDocument(access: OrgAccess, agentId: string, input: { name: string; mimeType: string; content: string }) {
  const a = await load(access.organizationId, agentId);
  if (a.documents.length >= MAX_DOCUMENTS) throw new ApiError("VALIDATION_ERROR", `An agent can have at most ${MAX_DOCUMENTS} documents.`);
  const mime = input.mimeType.split(";")[0].trim().toLowerCase() || "text/plain";
  if (!DOC_TYPES[mime]) throw new ApiError("VALIDATION_ERROR", "Only plain-text documents are supported (TXT, Markdown or CSV). For PDFs or Word files, paste the text instead.", { details: { file: ["Unsupported type"] } });
  const content = input.content.replace(/\u0000/g, "").trim();
  const size = Buffer.byteLength(content, "utf8");
  if (!content) throw new ApiError("VALIDATION_ERROR", "The document is empty.", { details: { file: ["Empty"] } });
  if (size > MAX_DOCUMENT_BYTES) throw new ApiError("VALIDATION_ERROR", `Documents can be up to ${MAX_DOCUMENT_BYTES / 1000} KB of text.`, { details: { file: ["Too large"] } });
  const d = await db.aiDocument.create({ data: { organizationId: access.organizationId, agentId: a.id, name: input.name.slice(0, 120) || "Document", mimeType: mime, sizeBytes: size, content } });
  await db.aiAgent.update({ where: { id: a.id }, data: { updatedAt: new Date() } });
  return { id: d.id, name: d.name, mimeType: d.mimeType, sizeBytes: d.sizeBytes, createdAt: d.createdAt };
}

export async function deleteDocument(access: OrgAccess, agentId: string, docId: string) {
  await load(access.organizationId, agentId);
  const r = await db.aiDocument.deleteMany({ where: { id: docId, agentId, organizationId: access.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Document not found.");
}

export async function listInteractions(organizationId: string, agentId: string, f: { page: number; pageSize: number }) {
  await load(organizationId, agentId);
  const where = { organizationId, agentId };
  const [rows, total] = await Promise.all([
    db.aiInteraction.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    db.aiInteraction.count({ where }),
  ]);
  const contacts = await db.contact.findMany({ where: { organizationId, id: { in: rows.map((r) => r.contactId).filter((x): x is string => !!x) } }, select: { id: true, name: true, phone: true } });
  return {
    interactions: rows.map((r) => ({
      id: r.id,
      mode: r.mode,
      kind: r.kind,
      input: r.input,
      output: r.output,
      actions: (() => {
        try {
          return JSON.parse(r.actions) as unknown[];
        } catch {
          return [];
        }
      })(),
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      error: r.error,
      isTest: r.isTest,
      conversationId: r.conversationId,
      contact: contacts.find((c) => c.id === r.contactId) ?? null,
      createdAt: r.createdAt,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Appointments (requested by the AI agent or a Flow)
// ---------------------------------------------------------------------------

export async function listAppointments(organizationId: string, f: { status?: string; page: number; pageSize: number }) {
  const where: Prisma.AppointmentWhereInput = { organizationId, ...(f.status ? { status: f.status } : {}) };
  const [rows, total] = await Promise.all([
    db.appointment.findMany({ where, include: { contact: { select: { id: true, name: true, phone: true } } }, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    db.appointment.count({ where }),
  ]);
  return { appointments: rows, total };
}

export async function updateAppointment(access: OrgAccess, id: string, input: { status: string; startsAt?: Date | null; notes?: string }, req?: Request) {
  const a = await db.appointment.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!a) throw new ApiError("NOT_FOUND", "Appointment not found.");
  const u = await db.appointment.update({
    where: { id: a.id },
    data: { status: input.status, ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}) },
    include: { contact: { select: { id: true, name: true, phone: true } } },
  });
  await audit({ action: "appointment.updated", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "appointment", targetId: id, metadata: { from: a.status, to: input.status }, req });
  return u;
}
