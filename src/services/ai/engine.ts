import type { AiAgent, Conversation } from "@prisma/client";
import { hasFeature, monthlyQuotaLeft } from "@/services/billing/entitlements";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { publish } from "@/lib/realtime/broker";
import { incrementUsage } from "@/lib/services/usage";
import type { OrgAccess } from "@/lib/session";
import { DEMO_LABEL, demoRespond, demoSummary, type AgentConfig, type AiAction, type AiTurn, type ChatTurn, type KnownContact } from "@/lib/ai";
import { AiError, aiConfigured } from "@/providers/anthropic/reply";
import { liveRespond, liveSummary } from "@/providers/anthropic/agent";
import { agentConfig, agentParts } from "@/services/ai/agents";
import { updateContact } from "@/services/inbox/contacts";
import { pickLeastBusyMember, systemAssign } from "@/services/inbox/routing";
import { sendSystemText, SystemSendError } from "@/services/inbox/messaging";

/** Message types the agent answers; media, reactions, flows etc. are left to people. */
const ANSWERABLE = new Set(["text", "button", "interactive"]);
const HISTORY = 20;

/** The active agent answering a WhatsApp number (agents with no numbers selected answer all numbers). */
export async function agentForAccount(organizationId: string, whatsappAccountId: string): Promise<AiAgent | null> {
  const agents = await db.aiAgent.findMany({ where: { organizationId, status: "active" }, orderBy: { updatedAt: "desc" } });
  return agents.find((a) => agentParts(a).accountIds.includes(whatsappAccountId)) ?? agents.find((a) => !agentParts(a).accountIds.length) ?? null;
}

/**
 * Which engine may answer: live (Claude) whenever ANTHROPIC_API_KEY is set;
 * otherwise the rule-based demo engine, and only on demo numbers — real
 * customers never get rule-based replies presented as AI.
 */
export function engineMode(isDemoNumber: boolean): "live" | "demo" | null {
  if (aiConfigured()) return "live";
  return isDemoNumber ? "demo" : null;
}

async function history(conversationId: string): Promise<ChatTurn[]> {
  const rows = await db.message.findMany({ where: { conversationId, direction: { in: ["inbound", "outbound"] }, body: { not: "" } }, orderBy: { createdAt: "desc" }, take: HISTORY, select: { direction: true, body: true } });
  return rows.reverse().map((m) => ({ role: m.direction === "inbound" ? ("customer" as const) : ("business" as const), text: m.body }));
}

async function knownContact(contactId: string): Promise<KnownContact> {
  const c = await db.contact.findUniqueOrThrow({ where: { id: contactId }, select: { name: true, email: true, customFields: true } });
  let custom: Record<string, string> = {};
  try {
    custom = JSON.parse(c.customFields || "{}") as Record<string, string>;
  } catch {
    /* keep empty */
  }
  return { name: c.name, email: c.email, customFields: custom };
}

async function systemNote(organizationId: string, conversationId: string, body: string) {
  await db.message.create({ data: { organizationId, conversationId, direction: "internal", type: "system", body: body.slice(0, 1000), status: "received" } });
}

async function internalNote(organizationId: string, conversationId: string, body: string) {
  await db.message.create({ data: { organizationId, conversationId, direction: "internal", type: "note", body: body.slice(0, 4000), status: "received" } });
}

/** Performs one AI action on the real CRM. Returns a short result for the model. */
async function applyAction(organizationId: string, conv: Conversation, agent: AiAgent, a: AiAction): Promise<string> {
  const ctx = { organizationId, actorUserId: null };
  if (a.type === "collect") {
    const contact = await db.contact.findUniqueOrThrow({ where: { id: conv.contactId } });
    let custom: Record<string, string> = {};
    try {
      custom = JSON.parse(contact.customFields || "{}") as Record<string, string>;
    } catch {
      /* keep empty */
    }
    const patch: Parameters<typeof updateContact>[2] = {};
    const saved: string[] = [];
    for (const [k, v] of Object.entries(a.fields)) {
      if (k === "name") patch.name = v.slice(0, 120);
      else if (k === "email") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) continue;
        patch.email = v.toLowerCase().slice(0, 255);
      } else custom[k] = v.slice(0, 500);
      saved.push(k);
    }
    if (saved.some((k) => k !== "name" && k !== "email")) patch.customFields = custom;
    if (Object.keys(patch).length) await updateContact(ctx, contact.id, patch);
    return saved.length ? `Saved: ${saved.join(", ")}.` : "Nothing valid to save.";
  }
  if (a.type === "qualify") {
    const contact = await db.contact.findUniqueOrThrow({ where: { id: conv.contactId }, select: { id: true, lifecycle: true, leadStatus: true } });
    if (contact.lifecycle === "customer") return "Already a customer — lead status unchanged.";
    // Never move a lead backwards from a later stage set by the team.
    if (["proposal", "won"].includes(contact.leadStatus)) return `Lead status kept at ${contact.leadStatus}.`;
    if (contact.leadStatus !== a.status) await updateContact(ctx, contact.id, { lifecycle: "lead", leadStatus: a.status });
    return `Lead marked ${a.status}.`;
  }
  if (a.type === "book") {
    const appt = await db.appointment.create({
      data: { organizationId, contactId: conv.contactId, conversationId: conv.id, service: a.service, requestedFor: a.requestedFor, notes: a.notes, source: "ai", status: "requested" },
    });
    await audit({ action: "appointment.created", organizationId, targetType: "appointment", targetId: appt.id, metadata: { source: "ai", agent: agent.name } });
    await systemNote(organizationId, conv.id, `AI agent requested an appointment: ${a.service} · ${a.requestedFor}`);
    const managers = await db.organizationMember.findMany({ where: { organizationId, role: { in: ["CLIENT_OWNER", "MANAGER"] } }, select: { userId: true } });
    for (const m of managers) await notify({ userId: m.userId, organizationId, title: "New appointment request", body: `${a.service} · ${a.requestedFor}`, link: "/ai?tab=appointments" });
    return "Appointment request created. The team will confirm the exact slot.";
  }
  return "";
}

/**
 * Hands the chat to people: the AI stops, the chat is assigned per the
 * agent's settings, the team is notified and a summary is left as a note.
 */
export async function handoffToHuman(organizationId: string, conversationId: string, agent: AiAgent | null, reason: string, opts: { summary?: string } = {}) {
  const conv = await db.conversation.findFirstOrThrow({ where: { id: conversationId, organizationId }, include: { contact: { select: { name: true, phone: true } } } });
  const h = agent ? agentParts(agent).handoff : null;
  const resumeAt = h?.resume === "after_hours" ? new Date(Date.now() + h.resumeAfterHours * 3_600_000) : null;
  await db.conversation.update({ where: { id: conv.id }, data: { aiStatus: "handoff", aiHandoffAt: new Date(), aiHandoffReason: reason.slice(0, 300), aiResumeAt: resumeAt } });
  await systemNote(organizationId, conv.id, `AI agent handed this chat to the team — ${reason}`);
  if (opts.summary) await internalNote(organizationId, conv.id, opts.summary);

  let assignedTo: string | null = null;
  if (!conv.assignedToUserId && h) {
    const target =
      h.assign === "user"
        ? ((await db.organizationMember.findFirst({ where: { organizationId, userId: h.userId, user: { status: "active" } } }))?.userId ?? (await pickLeastBusyMember(organizationId)))
        : h.assign === "auto"
          ? await pickLeastBusyMember(organizationId)
          : null;
    if (target) {
      await systemAssign(organizationId, conv.id, target, "AI agent", `Handoff: ${reason}`);
      assignedTo = target;
    }
  }
  if (!assignedTo && !conv.assignedToUserId) {
    // Queue: tell owners/managers there's a chat waiting for a person.
    const managers = await db.organizationMember.findMany({ where: { organizationId, role: { in: ["CLIENT_OWNER", "MANAGER"] } }, select: { userId: true } });
    for (const m of managers) await notify({ userId: m.userId, organizationId, title: `Chat needs a person: ${conv.contact.name || conv.contact.phone}`, body: reason, link: `/inbox?c=${conv.id}` });
  } else if (conv.assignedToUserId) {
    await notify({ userId: conv.assignedToUserId, organizationId, title: `AI handed over: ${conv.contact.name || conv.contact.phone}`, body: reason, link: `/inbox?c=${conv.id}` });
  }
  await audit({ action: "ai.handoff", organizationId, targetType: "conversation", targetId: conv.id, metadata: { reason: reason.slice(0, 200), agent: agent?.name ?? null, assignedTo } });
  publish(organizationId, { type: "conversation.updated", conversationId: conv.id, assignedToUserId: assignedTo ?? conv.assignedToUserId });
  return { assignedTo };
}

/** Gives the chat back to the AI: clears the handoff and the assignment so the agent can answer again. */
export async function resumeAi(organizationId: string, conversationId: string, by: { userId: string | null; label: string }) {
  const conv = await db.conversation.findFirstOrThrow({ where: { id: conversationId, organizationId } });
  await db.$transaction([
    db.conversation.update({ where: { id: conv.id }, data: { aiStatus: "", aiHandoffAt: null, aiHandoffReason: "", aiResumeAt: null, assignedToUserId: null } }),
    ...(conv.assignedToUserId
      ? [db.conversationAssignment.create({ data: { organizationId, conversationId: conv.id, action: "unassigned", fromUserId: conv.assignedToUserId, toUserId: null, byUserId: by.userId, note: "Handed back to the AI agent" } })]
      : []),
  ]);
  await systemNote(organizationId, conv.id, `${by.label} — AI agent resumed`);
  await audit({ action: "ai.resumed", actorUserId: by.userId, organizationId, targetType: "conversation", targetId: conv.id, metadata: { by: by.label } });
  publish(organizationId, { type: "conversation.updated", conversationId: conv.id, assignedToUserId: null });
  if (conv.assignedToUserId) publish(organizationId, { type: "conversation.updated", conversationId: conv.id, assignedToUserId: conv.assignedToUserId });
}

async function log(agent: AiAgent, data: { conversationId?: string | null; contactId?: string | null; mode: string; kind: string; input?: string; output?: string; actions?: AiAction[]; model?: string; inputTokens?: number; outputTokens?: number; error?: string; isTest?: boolean }) {
  await db.aiInteraction.create({
    data: {
      organizationId: agent.organizationId,
      agentId: agent.id,
      conversationId: data.conversationId ?? null,
      contactId: data.contactId ?? null,
      mode: data.mode,
      kind: data.kind,
      input: (data.input ?? "").slice(0, 2000),
      output: (data.output ?? "").slice(0, 4000),
      actions: JSON.stringify(data.actions ?? []),
      model: data.model ?? "",
      inputTokens: data.inputTokens ?? 0,
      outputTokens: data.outputTokens ?? 0,
      error: (data.error ?? "").slice(0, 500),
      isTest: data.isTest ?? false,
    },
  });
}

export type InboundForAi = { conversationId: string; contactId: string; whatsappAccountId: string; messageId: string; type: string; text: string; optOut: boolean; automationHandled: boolean };

/**
 * Called for every inbound message after automations had their turn. The AI
 * answers only when: an active agent covers the number, nobody on the team
 * owns the chat, the AI hasn't handed off (or the handoff expired per the
 * agent's resume rule), no automation took the message, and it isn't STOP.
 */
export async function handleInboundForAi(organizationId: string, ev: InboundForAi): Promise<{ status: string; reply?: string }> {
  if (ev.optOut || !ANSWERABLE.has(ev.type) || !ev.text.trim()) return { status: "not_applicable" };
  const agent = await agentForAccount(organizationId, ev.whatsappAccountId);
  if (!agent) return { status: "no_agent" };
  if (ev.automationHandled) {
    await log(agent, { conversationId: ev.conversationId, contactId: ev.contactId, mode: "", kind: "skipped", input: ev.text, error: "An automation handled this message, so the AI stayed quiet." });
    return { status: "automation_handled" };
  }
  let conv = await db.conversation.findFirst({ where: { id: ev.conversationId, organizationId }, include: { whatsappAccount: { select: { isDemo: true } } } });
  if (!conv) return { status: "no_conversation" };

  if (conv.aiStatus === "handoff") {
    if (conv.aiResumeAt && conv.aiResumeAt <= new Date()) {
      await resumeAi(organizationId, conv.id, { userId: null, label: "No team reply within the configured time" });
      conv = (await db.conversation.findUnique({ where: { id: conv.id }, include: { whatsappAccount: { select: { isDemo: true } } } }))!;
    } else return { status: "handed_off" };
  }
  if (conv.assignedToUserId) return { status: "assigned" };
  // An automation still running for this contact keeps the floor.
  const running = await db.automationExecution.count({ where: { organizationId, contactId: ev.contactId, status: { in: ["queued", "running"] }, isTest: false } });
  if (running) {
    await log(agent, { conversationId: conv.id, contactId: ev.contactId, mode: "", kind: "skipped", input: ev.text, error: "An automation is still running for this contact, so the AI stayed quiet." });
    return { status: "automation_running" };
  }

  if (!(await hasFeature(organizationId, "ai_agent"))) {
    await log(agent, { conversationId: conv.id, contactId: ev.contactId, mode: "", kind: "skipped", input: ev.text, error: "The AI agent isn't included in this workspace's plan." });
    return { status: "not_in_plan" };
  }
  const mode = engineMode(conv.whatsappAccount.isDemo);
  if (mode === "live" && !(await monthlyQuotaLeft(organizationId, "aiReplies"))) {
    await log(agent, { conversationId: conv.id, contactId: ev.contactId, mode: "live", kind: "skipped", input: ev.text, error: "This month's AI reply allowance on the plan is used up." });
    return { status: "quota_reached" };
  }
  if (!mode) {
    await log(agent, { conversationId: conv.id, contactId: ev.contactId, mode: "live", kind: "skipped", input: ev.text, error: "Live AI isn't configured (ANTHROPIC_API_KEY is not set), so the agent can't answer on a live number. Demo AI only runs on demo numbers." });
    return { status: "not_configured" };
  }

  const cfg = await agentConfig(agent);
  const known = await knownContact(ev.contactId);
  let turn: AiTurn;
  try {
    if (mode === "live") {
      turn = await liveRespond(cfg, await history(conv.id), known, (a) => applyAction(organizationId, conv!, agent, a));
    } else {
      turn = demoRespond(cfg, ev.text, known);
      for (const a of turn.actions) if (a.type !== "transfer" && a.type !== "answer") await applyAction(organizationId, conv, agent, a);
    }
  } catch (e) {
    const msg = e instanceof AiError ? e.message : "AI request failed.";
    await log(agent, { conversationId: conv.id, contactId: ev.contactId, mode, kind: "error", input: ev.text, error: msg });
    // A broken AI must not leave the customer unanswered: hand the chat to people.
    if (cfg.actions.transfer) await handoffToHuman(organizationId, conv.id, agent, `The AI couldn't answer (${msg})`);
    return { status: "error" };
  }

  if (conv.aiStatus !== "active") await db.conversation.update({ where: { id: conv.id }, data: { aiStatus: "active" } });
  let sendError = "";
  try {
    await sendSystemText(organizationId, conv.id, turn.reply, { origin: mode === "live" ? "ai" : "ai_demo", agentId: agent.id, ...(mode === "demo" ? { label: DEMO_LABEL } : {}) });
    if (mode === "live") await incrementUsage(organizationId, "ai_replies");
  } catch (e) {
    sendError = e instanceof SystemSendError ? e.message : "Sending failed.";
  }
  if (turn.handoff) {
    let summary = "";
    if (cfg.actions.summarize) summary = await summarize(agent, cfg, conv.id, ev.contactId, mode).catch(() => "");
    await handoffToHuman(organizationId, conv.id, agent, turn.handoff.reason, { summary });
  }
  await log(agent, { conversationId: conv.id, contactId: ev.contactId, mode, kind: turn.handoff ? "handoff" : "reply", input: ev.text, output: turn.reply, actions: turn.actions, model: turn.model, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, error: sendError });
  return { status: sendError ? "send_failed" : turn.handoff ? "handoff" : "replied", reply: turn.reply };
}

async function summarize(agent: AiAgent, cfg: AgentConfig, conversationId: string, contactId: string | null, mode: "live" | "demo"): Promise<string> {
  const h = await history(conversationId);
  if (mode === "live") {
    const s = await liveSummary(cfg, h);
    await log(agent, { conversationId, contactId, mode, kind: "summary", output: s.text, model: s.model, inputTokens: s.inputTokens, outputTokens: s.outputTokens });
    return `🤖 AI summary\n${s.text}`;
  }
  const text = demoSummary(h, contactId ? await knownContact(contactId) : { name: "", email: "", customFields: {} });
  await log(agent, { conversationId, contactId, mode, kind: "summary", output: text, model: "demo-rules" });
  return text;
}

// ---------------------------------------------------------------------------
// Team-facing controls (inbox) and hooks from human activity
// ---------------------------------------------------------------------------

export async function conversationAiState(organizationId: string, conv: { id: string; whatsappAccountId: string; aiStatus: string; aiHandoffReason: string; aiResumeAt: Date | null; isDemo: boolean }) {
  const agent = await agentForAccount(organizationId, conv.whatsappAccountId);
  return {
    agent: agent ? { id: agent.id, name: agent.name, resume: agentParts(agent).handoff.resume } : null,
    status: conv.aiStatus || "idle",
    reason: conv.aiHandoffReason,
    resumeAt: conv.aiResumeAt,
    mode: engineMode(conv.isDemo),
  };
}

export async function conversationAiAction(access: OrgAccess, conversationId: string, action: "pause" | "resume" | "summarize") {
  const orgId = access.organizationId;
  const conv = await db.conversation.findFirst({ where: { id: conversationId, organizationId: orgId }, include: { whatsappAccount: { select: { isDemo: true } } } });
  if (!conv) throw new ApiError("NOT_FOUND", "Conversation not found.");
  const actor = await db.user.findUnique({ where: { id: access.user.id }, select: { name: true, email: true } });
  const who = actor?.name ?? actor?.email ?? "A teammate";
  const agent = await agentForAccount(orgId, conv.whatsappAccountId);
  if (action === "pause") {
    if (conv.aiStatus === "handoff") return { ok: true };
    await db.conversation.update({ where: { id: conv.id }, data: { aiStatus: "handoff", aiHandoffAt: new Date(), aiHandoffReason: `Paused by ${who}`, aiResumeAt: null } });
    await systemNote(orgId, conv.id, `${who} paused the AI agent in this chat`);
    await audit({ action: "ai.handoff", actorUserId: access.user.id, organizationId: orgId, targetType: "conversation", targetId: conv.id, metadata: { reason: "paused manually" } });
    publish(orgId, { type: "conversation.updated", conversationId: conv.id, assignedToUserId: conv.assignedToUserId });
    return { ok: true };
  }
  if (action === "resume") {
    if (!agent) throw new ApiError("CONFLICT", "No active AI agent answers this number — activate one on the AI Agent page first.");
    await resumeAi(orgId, conv.id, { userId: access.user.id, label: who });
    return { ok: true };
  }
  if (!agent) throw new ApiError("CONFLICT", "No active AI agent answers this number.");
  const mode = engineMode(conv.whatsappAccount.isDemo) ?? "demo";
  const cfg = await agentConfig(agent);
  let summary: string;
  try {
    summary = await summarize(agent, cfg, conv.id, conv.contactId, mode);
  } catch (e) {
    throw new ApiError("SERVICE_UNAVAILABLE", e instanceof AiError ? e.message : "Couldn't summarise right now.");
  }
  await internalNote(orgId, conv.id, summary);
  publish(orgId, { type: "message.created", conversationId: conv.id, messageId: "", assignedToUserId: conv.assignedToUserId });
  return { ok: true, summary, mode };
}

/** A teammate replied in the chat: the AI steps back (and the after-hours timer restarts). */
export async function onHumanReply(organizationId: string, conversationId: string, userLabel: string) {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, organizationId } });
  if (!conv) return;
  const agent = await agentForAccount(organizationId, conv.whatsappAccountId);
  if (!agent && conv.aiStatus !== "active") return;
  const h = agent ? agentParts(agent).handoff : null;
  const resumeAt = h?.resume === "after_hours" ? new Date(Date.now() + h.resumeAfterHours * 3_600_000) : null;
  if (conv.aiStatus === "handoff") {
    if (resumeAt) await db.conversation.update({ where: { id: conv.id }, data: { aiResumeAt: resumeAt } });
    return;
  }
  await db.conversation.update({ where: { id: conv.id }, data: { aiStatus: "handoff", aiHandoffAt: new Date(), aiHandoffReason: `${userLabel} replied`, aiResumeAt: resumeAt } });
  await systemNote(organizationId, conv.id, `AI agent stepped back — ${userLabel} replied`);
}

/** Chat closed: agents set to resume "on close" take the next conversation again. */
export async function onConversationClosed(organizationId: string, conversationId: string) {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, organizationId } });
  if (!conv || conv.aiStatus !== "handoff") return;
  const agent = await agentForAccount(organizationId, conv.whatsappAccountId);
  if (!agent || agentParts(agent).handoff.resume !== "on_close") return;
  await resumeAi(organizationId, conv.id, { userId: null, label: "Chat closed" });
}

// ---------------------------------------------------------------------------
// Test chat (the /ai playground): no CRM changes, nothing sent to WhatsApp
// ---------------------------------------------------------------------------

export async function testChat(access: OrgAccess, agentId: string, input: { history: ChatTurn[]; message: string; mode: "live" | "demo" }) {
  const agent = await db.aiAgent.findFirst({ where: { id: agentId, organizationId: access.organizationId } });
  if (!agent) throw new ApiError("NOT_FOUND", "AI agent not found.");
  if (input.mode === "live" && !aiConfigured()) throw new ApiError("CONFLICT", "Live AI isn't configured on this installation (ANTHROPIC_API_KEY is not set). Use demo mode.");
  const cfg = await agentConfig(agent);
  const known: KnownContact = { name: "", email: "", customFields: {} };
  let turn: AiTurn;
  try {
    turn =
      input.mode === "live"
        ? await liveRespond(cfg, [...input.history, { role: "customer", text: input.message }], known, async (a) => (a.type === "book" ? "Appointment request noted (test — nothing saved)." : "Noted (test — nothing saved)."))
        : demoRespond(cfg, input.message, known);
  } catch (e) {
    const msg = e instanceof AiError ? e.message : "AI request failed.";
    await log(agent, { mode: input.mode, kind: "error", input: input.message, error: msg, isTest: true });
    throw new ApiError("SERVICE_UNAVAILABLE", msg);
  }
  if (turn.mode === "live") await incrementUsage(access.organizationId, "ai_replies");
  await log(agent, { mode: input.mode, kind: turn.handoff ? "handoff" : "reply", input: input.message, output: turn.reply, actions: turn.actions, model: turn.model, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, isTest: true });
  return { ...turn, label: turn.mode === "demo" ? DEMO_LABEL : `Live AI (${turn.model})` };
}
