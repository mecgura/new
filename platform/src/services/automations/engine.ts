import { randomUUID } from "node:crypto";
import { Prisma, type Automation, type AutomationExecution } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime/broker";
import { runAfterResponse } from "@/lib/background";
import { assertPublicHttpsUrl, UnsafeUrlError } from "@/lib/safe-fetch";
import {
  delayMinutes,
  evaluateCondition,
  istNow,
  keywordMatches,
  renderText,
  type EvalContact,
  type FlowEdge,
  type FlowNode,
  type Graph,
  type NodeDataMap,
  type TriggerData,
  type TriggerType,
} from "@/lib/automations";
import { templateSlots } from "@/lib/templates";
import { preview, templateMessage, toPayload, transmit, assertTemplateValues, WINDOW_MS } from "@/services/inbox/messaging";
import { requireApprovedTemplate, toDef } from "@/services/templates/templates";
import { resolveValue } from "@/services/campaigns/compliance";
import { AiError, generateReply } from "@/providers/anthropic/reply";
import { billingState } from "@/services/billing/entitlements";
import { pickLeastBusyMember, systemAssign } from "@/services/inbox/routing";

// ---------------------------------------------------------------------------
// Safety limits — no infinite loops, bounded retries, bounded fan-out
// ---------------------------------------------------------------------------

export const MAX_STEPS = 100; // per execution (graphs are acyclic; this is a second guard)
export const MAX_DEPTH = 3; // an execution's actions may trigger others, at most 3 levels deep
export const MAX_RETRIES = 3;
export const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];
export const CONTACT_RATE_LIMIT = 10; // executions started per contact per minute, org-wide
const LEASE_MS = 60_000;

/** A step failure. `retryable` failures are retried with backoff; others fail (or continue, per the node's setting). */
export class StepError extends Error {
  constructor(
    message: string,
    readonly retryable = false
  ) {
    super(message);
  }
}

type Origin = { executionId: string; automationId: string; depth: number; chain: string[] };

export type AutomationEvent =
  | { type: "new_contact"; contactId: string; source: string }
  | {
      type: "inbound";
      contactId: string;
      conversationId: string;
      whatsappAccountId: string;
      messageId: string;
      text: string;
      messageType: string;
      replyToTemplateId: string | null;
      flowName: string | null;
      optOut: boolean;
    }
  | { type: "tag_added"; contactId: string; tagName: string }
  | { type: "lead_status"; contactId: string; from: string; to: string };

type Ctx = { reply?: string; replied?: boolean; replyTimedOut?: boolean; ai?: string; webhook?: unknown; inflight?: string | null; conversationId?: string };

const parse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

// ---------------------------------------------------------------------------
// Triggers → executions
// ---------------------------------------------------------------------------

function candidates(ev: AutomationEvent): TriggerType[] {
  if (ev.type === "new_contact") return ["new_contact"];
  if (ev.type === "tag_added") return ["tag_added"];
  if (ev.type === "lead_status") return ["lead_status"];
  const t: TriggerType[] = ["incoming_message"];
  if (ev.text.trim()) t.push("keyword");
  if (ev.messageType === "button") t.push("button_click");
  if (ev.replyToTemplateId) t.push("template_reply");
  if (ev.messageType === "flow") t.push("flow_submission");
  return t;
}

function matches(type: string, cfg: TriggerData, ev: AutomationEvent): boolean {
  switch (type) {
    case "new_contact":
      return ev.type === "new_contact" && (cfg.sources?.length ? cfg.sources.includes(ev.source) : true);
    case "tag_added":
      return ev.type === "tag_added" && cfg.tagName.trim().toLowerCase() === ev.tagName.toLowerCase();
    case "lead_status":
      return ev.type === "lead_status" && (!cfg.leadStatus || cfg.leadStatus === ev.to);
    case "incoming_message":
      return ev.type === "inbound";
    case "keyword":
      return ev.type === "inbound" && keywordMatches(ev.text, cfg.keywords, cfg.match);
    case "button_click":
      return ev.type === "inbound" && ev.messageType === "button" && (!cfg.buttonText.trim() || ev.text.trim().toLowerCase() === cfg.buttonText.trim().toLowerCase());
    case "template_reply":
      return ev.type === "inbound" && Boolean(ev.replyToTemplateId) && (!cfg.templateId || cfg.templateId === ev.replyToTemplateId);
    case "flow_submission":
      return ev.type === "inbound" && ev.messageType === "flow";
    default:
      return false;
  }
}

/**
 * Entry point for everything that can start an automation. Never throws —
 * automation problems must not break the request that caused the event.
 */
/** Returns true when an automation took this event (resumed a waiting run or started one) — the AI agent stays quiet then. */
export async function dispatch(organizationId: string, ev: AutomationEvent, origin?: Origin): Promise<boolean> {
  let handled = false;
  try {
    if (origin && origin.depth > MAX_DEPTH) return false;
    if (ev.type === "inbound") {
      if (ev.optOut) {
        // STOP: nothing keeps messaging this customer.
        await db.automationExecution.updateMany({
          where: { organizationId, contactId: ev.contactId, status: { in: ["queued", "running"] } },
          data: { status: "stopped", error: "Contact opted out.", finishedAt: new Date(), lockedUntil: null },
        });
        return true;
      }
      // A reply to an automation that is waiting for one continues that automation instead of starting new ones.
      if (await resumeWaitingForReply(organizationId, ev)) return true;
    }
    const types = candidates(ev);
    const autos = await db.automation.findMany({ where: { organizationId, status: "active", triggerType: { in: types }, publishedVersionId: { not: null } } });
    for (const a of autos) {
      if (origin?.chain.includes(a.id)) continue; // an automation never re-triggers itself
      // An automation bound to one number only reacts to messages on that number.
      if (a.whatsappAccountId && ev.type === "inbound" && ev.whatsappAccountId !== a.whatsappAccountId) continue;
      if (!matches(a.triggerType, parse<TriggerData>(a.triggerConfig, {} as TriggerData), ev)) continue;
      const key = ev.type === "inbound" ? `msg:${ev.messageId}` : ev.type === "new_contact" ? `contact:${ev.contactId}` : `${ev.type}:${ev.contactId}:${randomUUID()}`;
      const started = await startExecution(a, {
        contactId: ev.contactId,
        conversationId: ev.type === "inbound" ? ev.conversationId : null,
        triggerData: ev,
        dedupeKey: `${a.id}:${key}`,
        origin,
      });
      if (started) handled = true;
    }
  } catch (e) {
    console.error("[automations] dispatch failed:", e);
  }
  return handled;
}

type StartInput = { contactId: string | null; conversationId?: string | null; triggerData: unknown; dedupeKey?: string; origin?: Origin; test?: { graph: Graph; skipDelays: boolean } };

/** Creates an execution (guarded against duplicates, concurrency and runaway re-entry) and starts it. */
export async function startExecution(a: Automation, input: StartInput): Promise<AutomationExecution | null> {
  let graph: string;
  let version = 0;
  if (input.test) {
    graph = JSON.stringify(input.test.graph);
  } else {
    const v = a.publishedVersionId ? await db.automationVersion.findUnique({ where: { id: a.publishedVersionId } }) : null;
    if (!v) return null;
    graph = v.graph;
    version = v.version;
  }
  if (input.contactId && !input.test) {
    const busy = await db.automationExecution.count({ where: { automationId: a.id, contactId: input.contactId, status: { in: ["queued", "running"] }, isTest: false } });
    if (busy) return null; // one live run per contact per automation
    const settings = parse<{ reentry?: string }>(a.settings, {});
    if (settings.reentry === "once" && (await db.automationExecution.count({ where: { automationId: a.id, contactId: input.contactId, isTest: false } }))) return null;
    const recent = await db.automationExecution.count({ where: { organizationId: a.organizationId, contactId: input.contactId, createdAt: { gte: new Date(Date.now() - 60_000) } } });
    if (recent >= CONTACT_RATE_LIMIT) {
      console.warn(`[automations] rate limit: contact ${input.contactId} started ${recent} runs in a minute — skipping ${a.id}`);
      return null;
    }
  }
  const nodes = parse<Graph>(graph, { nodes: [], edges: [] }).nodes;
  const trigger = nodes.find((n) => n.type === "trigger");
  if (!trigger) return null;
  let ex: AutomationExecution;
  try {
    ex = await db.automationExecution.create({
      data: {
        organizationId: a.organizationId,
        automationId: a.id,
        version,
        graph,
        contactId: input.contactId,
        conversationId: input.conversationId ?? null,
        triggerType: (trigger.data as TriggerData).trigger,
        triggerData: JSON.stringify(input.triggerData ?? {}).slice(0, 20_000),
        context: JSON.stringify({ chain: [...(input.origin?.chain ?? []), a.id] }),
        currentNodeId: trigger.id,
        nextRunAt: new Date(),
        depth: input.origin?.depth ?? 0, // origin.depth is already the child's depth
        dedupeKey: input.dedupeKey ?? null,
        isTest: Boolean(input.test),
        skipDelays: input.test?.skipDelays ?? false,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null; // same event delivered twice
    throw e;
  }
  publish(a.organizationId, { type: "automation.updated", automationId: a.id });
  runAfterResponse(() => runExecution(ex.id));
  return ex;
}

async function resumeWaitingForReply(organizationId: string, ev: Extract<AutomationEvent, { type: "inbound" }>) {
  const waiting = await db.automationExecution.findMany({ where: { organizationId, contactId: ev.contactId, status: "running", waitState: "reply" }, orderBy: { createdAt: "asc" } });
  for (const ex of waiting) {
    const ctx = parse<Ctx>(ex.context, {});
    const r = await db.automationExecution.updateMany({
      where: { id: ex.id, waitState: "reply" },
      data: { waitState: "", nextRunAt: new Date(), context: JSON.stringify({ ...ctx, reply: ev.text, replied: true, replyTimedOut: false }) },
    });
    if (r.count) runAfterResponse(() => runExecution(ex.id));
  }
  return waiting.length > 0;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

type Outcome =
  | { kind: "next"; handle?: string; output?: Record<string, unknown>; status?: "completed" | "skipped" }
  | { kind: "wait"; state: "delay" | "reply"; until: Date; output?: Record<string, unknown> }
  | { kind: "end" };

type RunCtx = {
  ex: AutomationExecution;
  automation: Automation;
  graph: Graph;
  node: FlowNode;
  ctx: Ctx;
  trigger: Record<string, unknown>;
};

const NON_IDEMPOTENT = new Set(["message", "template", "webhook", "ai_response"]);

/**
 * Runs one execution until it finishes, waits (delay / reply / retry) or the
 * time budget ends. A short lease stops two workers running the same execution.
 */
export async function runExecution(id: string, budgetMs = 20_000): Promise<string> {
  const now = new Date();
  const lease = await db.automationExecution.updateMany({
    where: {
      id,
      status: { in: ["queued", "running"] },
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
      AND: [{ OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }],
    },
    data: { status: "running", lockedUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (!lease.count) return "skipped";
  const started = Date.now();
  let ex = await db.automationExecution.findUniqueOrThrow({ where: { id } });
  if (!ex.startedAt) ex = await db.automationExecution.update({ where: { id }, data: { startedAt: new Date() } });
  const automation = await db.automation.findUniqueOrThrow({ where: { id: ex.automationId } });
  const graph = parse<Graph>(ex.graph, { nodes: [], edges: [] });
  let ctx = parse<Ctx>(ex.context, {});
  const trigger = parse<Record<string, unknown>>(ex.triggerData, {});

  // A reply wait that timed out continues with an empty reply.
  if (ex.waitState === "reply") ctx = { ...ctx, reply: "", replied: false, replyTimedOut: true };

  // Crash recovery: a non-idempotent step that was mid-flight is not repeated (no duplicate messages/webhooks).
  if (ctx.inflight && ctx.inflight === ex.currentNodeId) {
    const node = graph.nodes.find((n) => n.id === ex.currentNodeId);
    if (node && NON_IDEMPOTENT.has(node.type)) {
      await recordStep(ex, node, "failed", {}, "Interrupted while running — not repeated to avoid sending twice.", ex.attempts + 1);
      ctx.inflight = null;
      const cont = (node.data as { onError?: string }).onError === "continue";
      if (!cont) return finish(ex, automation, "failed", "A step was interrupted and wasn't repeated to avoid duplicates.");
      ex = await db.automationExecution.update({ where: { id }, data: { currentNodeId: nextOf(graph, node.id, "next"), attempts: 0, context: JSON.stringify(ctx) } });
    }
  }

  while (true) {
    const fresh = await db.automationExecution.findUnique({ where: { id }, select: { status: true } });
    if (fresh?.status !== "running") return fresh?.status ?? "missing"; // stopped from the UI
    if (!ex.currentNodeId) return finish(ex, automation, "completed");
    if (ex.stepCount >= MAX_STEPS) return finish(ex, automation, "failed", `Stopped after ${MAX_STEPS} steps (loop protection).`);
    if (Date.now() - started > budgetMs) {
      await db.automationExecution.update({ where: { id }, data: { lockedUntil: null, nextRunAt: new Date() } });
      return "yielded";
    }
    const node = graph.nodes.find((n) => n.id === ex.currentNodeId);
    if (!node) return finish(ex, automation, "failed", "The flow refers to a missing step.");

    if (NON_IDEMPOTENT.has(node.type)) {
      ctx.inflight = node.id;
      await db.automationExecution.update({ where: { id }, data: { context: JSON.stringify(ctx), lockedUntil: new Date(Date.now() + LEASE_MS) } });
    }
    let outcome: Outcome;
    try {
      outcome = await runNode({ ex, automation, graph, node, ctx, trigger });
    } catch (e) {
      ctx.inflight = null;
      const err = e instanceof StepError ? e : new StepError(e instanceof Error ? e.message : "Unexpected error", true);
      const attempt = ex.attempts + 1;
      if (err.retryable && attempt <= MAX_RETRIES) {
        await recordStep(ex, node, "retrying", { retryIn: RETRY_BACKOFF_MS[attempt - 1] / 1000 }, err.message, attempt);
        await db.automationExecution.update({
          where: { id },
          data: { attempts: attempt, waitState: "retry", nextRunAt: new Date(Date.now() + RETRY_BACKOFF_MS[attempt - 1]), lockedUntil: null, context: JSON.stringify(ctx), stepCount: { increment: 1 } },
        });
        publish(ex.organizationId, { type: "automation.updated", automationId: ex.automationId });
        return "retrying";
      }
      await recordStep(ex, node, "failed", {}, err.message, attempt);
      if ((node.data as { onError?: string }).onError === "continue") {
        ex = await advance(ex, nextOf(graph, node.id, "next"), ctx);
        continue;
      }
      return finish({ ...ex, context: JSON.stringify(ctx) }, automation, "failed", `${node.data.label || node.type}: ${err.message}`);
    }
    ctx.inflight = null;

    if (outcome.kind === "end") {
      await recordStep(ex, node, "completed", {}, "", ex.attempts + 1);
      return finish({ ...ex, context: JSON.stringify(ctx) }, automation, "completed");
    }
    if (outcome.kind === "wait") {
      const next = nextOf(graph, node.id, "next");
      await recordStep(ex, node, outcome.state === "reply" ? "waiting" : "completed", { ...outcome.output, until: outcome.until.toISOString() }, "", ex.attempts + 1);
      await db.automationExecution.update({
        where: { id },
        data: { currentNodeId: next, waitState: outcome.state, nextRunAt: outcome.until, lockedUntil: null, attempts: 0, stepCount: { increment: 1 }, context: JSON.stringify(ctx) },
      });
      publish(ex.organizationId, { type: "automation.updated", automationId: ex.automationId });
      return "waiting";
    }
    await recordStep(ex, node, outcome.status ?? "completed", outcome.output ?? {}, "", ex.attempts + 1);
    ex = await advance(ex, nextOf(graph, node.id, outcome.handle ?? "next"), ctx);
  }
}

function nextOf(g: Graph, nodeId: string, handle: string): string | null {
  const node = g.nodes.find((n) => n.id === nodeId);
  const edge = g.edges.find((e: FlowEdge) => e.source === nodeId && (node?.type === "condition" ? e.sourceHandle === handle : true));
  return edge?.target ?? null;
}

async function advance(ex: AutomationExecution, next: string | null, ctx: Ctx) {
  return db.automationExecution.update({
    where: { id: ex.id },
    data: { currentNodeId: next, attempts: 0, waitState: "", stepCount: { increment: 1 }, context: JSON.stringify(ctx), lockedUntil: new Date(Date.now() + LEASE_MS) },
  });
}

async function recordStep(ex: AutomationExecution, node: FlowNode, status: string, output: Record<string, unknown>, error: string, attempt: number) {
  await db.automationExecutionStep.create({
    data: { organizationId: ex.organizationId, executionId: ex.id, nodeId: node.id, nodeType: node.type, status, attempt, output: JSON.stringify(output).slice(0, 8000), error: error.slice(0, 1000), finishedAt: new Date() },
  });
}

async function finish(ex: AutomationExecution, automation: Automation, status: "completed" | "failed", error = "") {
  await db.automationExecution.update({
    where: { id: ex.id },
    data: { status, error: error.slice(0, 1000), finishedAt: new Date(), currentNodeId: null, waitState: "", lockedUntil: null, nextRunAt: null, context: ex.context },
  });
  if (!ex.isTest) await db.automation.update({ where: { id: automation.id }, data: { lastRunAt: new Date() } });
  publish(ex.organizationId, { type: "automation.updated", automationId: automation.id });
  return status;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function loadContact(organizationId: string, id: string | null): Promise<(EvalContact & { id: string; suppressed: boolean }) | null> {
  if (!id) return null;
  const c = await db.contact.findFirst({ where: { id, organizationId }, include: { tags: { include: { tag: true } } } });
  if (!c) return null;
  return { id: c.id, name: c.name, email: c.email, phone: c.phone, customFields: parse<Record<string, string>>(c.customFields, {}), tags: c.tags.map((t) => t.tag.name), leadStatus: c.leadStatus, source: c.source, optInStatus: c.optInStatus, suppressed: c.suppressed };
}

const vars = (r: RunCtx, contact: EvalContact | null) => ({ contact, reply: r.ctx.reply ?? "", ai: r.ctx.ai ?? "", trigger: String(r.trigger.text ?? "") });

async function runNode(r: RunCtx): Promise<Outcome> {
  const { node, ex } = r;
  const orgId = ex.organizationId;
  switch (node.type) {
    case "trigger":
      return { kind: "next", output: { trigger: (node.data as TriggerData).trigger } };
    case "end":
      return { kind: "end" };
    case "delay": {
      const d = node.data as NodeDataMap["delay"];
      if (ex.skipDelays) return { kind: "next", status: "skipped", output: { skipped: "Delay skipped in test run", minutes: delayMinutes(d) } };
      return { kind: "wait", state: "delay", until: new Date(Date.now() + delayMinutes(d) * 60_000), output: { minutes: delayMinutes(d) } };
    }
    case "condition": {
      const contact = await loadContact(orgId, ex.contactId);
      const d = node.data as NodeDataMap["condition"];
      const message = r.ctx.reply !== undefined ? r.ctx.reply : String(r.trigger.text ?? "");
      const ok = evaluateCondition(d, { message, contact, now: new Date() });
      return { kind: "next", handle: ok ? "yes" : "no", output: { result: ok ? "yes" : "no", message: message.slice(0, 200) } };
    }
    case "tag":
      return tagStep(r);
    case "assign":
      return assignStep(r);
    case "update_contact":
      return updateContactStep(r);
    case "message":
      return messageStep(r);
    case "template":
      return templateStep(r);
    case "webhook":
      return webhookStep(r);
    case "ai_response":
      return aiStep(r);
  }
}

function originOf(r: RunCtx): Origin {
  const chain = parse<{ chain?: string[] }>(r.ex.context, {}).chain ?? [r.automation.id];
  return { executionId: r.ex.id, automationId: r.automation.id, depth: r.ex.depth + 1, chain };
}

async function requireContact(r: RunCtx) {
  const c = await loadContact(r.ex.organizationId, r.ex.contactId);
  if (!c) throw new StepError("This run has no contact (it may have been deleted).");
  return c;
}

async function tagStep(r: RunCtx): Promise<Outcome> {
  const d = r.node.data as NodeDataMap["tag"];
  const c = await requireContact(r);
  const name = d.tagName.trim();
  const tag = await db.tag.upsert({ where: { organizationId_name: { organizationId: r.ex.organizationId, name } }, update: {}, create: { organizationId: r.ex.organizationId, name } });
  if (d.action === "add") {
    const had = await db.contactTag.findUnique({ where: { contactId_tagId: { contactId: c.id, tagId: tag.id } } });
    if (!had) {
      await db.contactTag.create({ data: { contactId: c.id, tagId: tag.id } });
      publish(r.ex.organizationId, { type: "contact.updated", contactId: c.id });
      await dispatch(r.ex.organizationId, { type: "tag_added", contactId: c.id, tagName: name }, originOf(r));
    }
    return { kind: "next", output: { tag: name, changed: !had } };
  }
  const del = await db.contactTag.deleteMany({ where: { contactId: c.id, tagId: tag.id } });
  if (del.count) publish(r.ex.organizationId, { type: "contact.updated", contactId: c.id });
  return { kind: "next", output: { tag: name, removed: del.count > 0 } };
}

async function updateContactStep(r: RunCtx): Promise<Outcome> {
  const d = r.node.data as NodeDataMap["update_contact"];
  const c = await requireContact(r);
  const value = renderText(d.value, vars(r, c)).slice(0, 500);
  const before = await db.contact.findUniqueOrThrow({ where: { id: c.id } });
  if (d.field === "custom") {
    await db.contact.update({ where: { id: c.id }, data: { customFields: JSON.stringify({ ...c.customFields, [d.key.trim()]: value }) } });
  } else if (d.field === "email") {
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new StepError(`“${value}” isn't a valid email.`);
    await db.contact.update({ where: { id: c.id }, data: { email: value.toLowerCase() } });
  } else {
    await db.contact.update({ where: { id: c.id }, data: { [d.field]: value } });
  }
  publish(r.ex.organizationId, { type: "contact.updated", contactId: c.id });
  if (d.field === "leadStatus" && before.leadStatus !== value) {
    await dispatch(r.ex.organizationId, { type: "lead_status", contactId: c.id, from: before.leadStatus, to: value }, originOf(r));
  }
  return { kind: "next", output: { field: d.field === "custom" ? d.key : d.field, value } };
}

/** The conversation the automation talks in: the triggering chat, else the automation's number, else the org's first connected number. */
async function conversationFor(r: RunCtx, contactId: string) {
  const orgId = r.ex.organizationId;
  const existingId = r.ctx.conversationId ?? r.ex.conversationId;
  if (existingId) {
    const c = await db.conversation.findFirst({ where: { id: existingId, organizationId: orgId }, include: { whatsappAccount: { include: { connection: { select: { encryptedAccessToken: true } } } } } });
    if (c) return c;
  }
  const live = { organizationId: orgId, contactId, whatsappAccount: { status: { in: ["connected", "demo"] } } };
  const recent =
    (r.automation.whatsappAccountId ? await db.conversation.findFirst({ where: { ...live, whatsappAccountId: r.automation.whatsappAccountId } }) : null) ??
    (await db.conversation.findFirst({ where: live, orderBy: { lastMessageAt: "desc" } }));
  if (recent) {
    r.ctx.conversationId = recent.id;
    return db.conversation.findUniqueOrThrow({ where: { id: recent.id }, include: { whatsappAccount: { include: { connection: { select: { encryptedAccessToken: true } } } } } });
  }
  const account =
    (r.automation.whatsappAccountId ? await db.whatsAppAccount.findFirst({ where: { id: r.automation.whatsappAccountId, organizationId: orgId, status: { in: ["connected", "demo"] } } }) : null) ??
    (await db.whatsAppAccount.findFirst({ where: { organizationId: orgId, status: { in: ["connected", "demo"] } }, orderBy: { createdAt: "asc" } }));
  if (!account) throw new StepError("No connected WhatsApp number to send from.");
  const conv =
    (await db.conversation.findUnique({ where: { whatsappAccountId_contactId: { whatsappAccountId: account.id, contactId } } })) ??
    (await db.conversation.create({ data: { organizationId: orgId, contactId, whatsappAccountId: account.id, isDemo: account.isDemo, lastMessagePreview: "" } }));
  r.ctx.conversationId = conv.id;
  return db.conversation.findUniqueOrThrow({ where: { id: conv.id }, include: { whatsappAccount: { include: { connection: { select: { encryptedAccessToken: true } } } } } });
}

type Conv = Awaited<ReturnType<typeof conversationFor>>;

/** Shared send path: consent checks, inbox message record, transmit, retry classification. */
async function sendOutbound(r: RunCtx, conv: Conv, contact: { id: string; phone: string; optInStatus: string; suppressed: boolean }, built: { payload: Parameters<typeof transmit>[3]; body: string; stored: Record<string, unknown>; type: string }) {
  if (contact.optInStatus === "opted_out") throw new StepError("The contact opted out — not messaged.");
  if (contact.suppressed) throw new StepError("The contact is on the suppression list — not messaged.");
  const acct = conv.whatsappAccount;
  if (acct.status !== "connected" && acct.status !== "demo") throw new StepError("The WhatsApp number is disconnected.");
  const billing = await billingState(r.ex.organizationId);
  if (billing.state === "blocked") throw new StepError(billing.reason);
  const msg = await db.message.create({
    data: {
      organizationId: r.ex.organizationId,
      conversationId: conv.id,
      direction: "outbound",
      type: built.type,
      body: built.body,
      payload: JSON.stringify({ ...built.stored, automationId: r.automation.id, automationName: r.automation.name, executionId: r.ex.id, test: r.ex.isTest || undefined }),
      status: "pending",
      isDemo: acct.isDemo,
    },
  });
  const now = new Date();
  await db.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: now, lastMessagePreview: preview(built.type, built.body), status: "open" } });
  await db.contact.update({ where: { id: contact.id }, data: { lastMessageAt: now } });
  const sent = await transmit(msg.id, { isDemo: acct.isDemo, phoneNumberId: acct.phoneNumberId, connection: acct.connection }, contact.phone, built.payload, undefined);
  publish(r.ex.organizationId, { type: "message.created", conversationId: conv.id, messageId: msg.id, assignedToUserId: conv.assignedToUserId });
  if (sent.status !== "sent") throw new StepError(`WhatsApp didn't accept the message: ${sent.error || "unknown error"}`, "retryable" in sent && Boolean(sent.retryable));
  if (acct.isDemo && acct.phoneRecordId) await db.phoneNumber.update({ where: { id: acct.phoneRecordId }, data: { messagesSent: { increment: 1 } } });
  return msg.id;
}

async function messageStep(r: RunCtx): Promise<Outcome> {
  const d = r.node.data as NodeDataMap["message"];
  const contact = await requireContact(r);
  const conv = await conversationFor(r, contact.id);
  const text = renderText(d.text, vars(r, contact)).slice(0, 1024);
  const windowOpen = Boolean(conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < WINDOW_MS);
  let messageId: string;
  let via = "session";
  if (windowOpen) {
    const input = d.buttons.length
      ? ({ type: "interactive", body: text, buttons: d.buttons.map((b, i) => ({ id: `btn_${i + 1}`, title: b.slice(0, 20) })) } as const)
      : ({ type: "text", body: text } as const);
    const built = toPayload(input);
    messageId = await sendOutbound(r, conv, contact, { ...built, type: input.type });
  } else if (d.fallbackTemplateId) {
    // Outside the 24-hour window WhatsApp only allows approved templates.
    const t = await requireApprovedTemplate(r.ex.organizationId, conv.whatsappAccount.wabaRecordId, { templateId: d.fallbackTemplateId }).catch((e: Error) => {
      throw new StepError(`Fallback template: ${e.message}`);
    });
    if (t.category === "MARKETING" && contact.optInStatus !== "opted_in") throw new StepError("The 24-hour window is closed and the contact has no marketing opt-in.");
    const values = Object.fromEntries(templateSlots(toDef(t)).map((s) => [s.key, s.part === "body" && s.index === 1 ? contact.name.split(/\s+/)[0] || "there" : ""]));
    assertTemplateValues(t, values);
    messageId = await sendOutbound(r, conv, contact, { ...templateMessage(t, values), type: "template" });
    via = `template ${t.name}`;
  } else {
    throw new StepError("The 24-hour window is closed. Add a fallback template to this step to reach customers who haven't messaged recently.");
  }
  if (d.waitForReply) return { kind: "wait", state: "reply", until: new Date(Date.now() + d.replyTimeoutMinutes * 60_000), output: { messageId, via, waitingForReply: true } };
  return { kind: "next", output: { messageId, via } };
}

async function templateStep(r: RunCtx): Promise<Outcome> {
  const d = r.node.data as NodeDataMap["template"];
  const contact = await requireContact(r);
  const conv = await conversationFor(r, contact.id);
  const t = await requireApprovedTemplate(r.ex.organizationId, conv.whatsappAccount.wabaRecordId, { templateId: d.templateId }).catch((e: Error) => {
    throw new StepError(e.message);
  });
  if (t.category === "MARKETING" && contact.optInStatus !== "opted_in") throw new StepError("Marketing templates need a recorded opt-in — this contact has none.");
  const values = Object.fromEntries(templateSlots(toDef(t)).map((s) => [s.key, resolveValue(d.variables[s.key], { ...contact, customFields: JSON.stringify(contact.customFields) })]));
  try {
    assertTemplateValues(t, values);
  } catch {
    throw new StepError("A template variable has no value for this contact.");
  }
  const messageId = await sendOutbound(r, conv, contact, { ...templateMessage(t, values), type: "template" });
  return { kind: "next", output: { messageId, template: t.name } };
}

async function assignStep(r: RunCtx): Promise<Outcome> {
  const d = r.node.data as NodeDataMap["assign"];
  const contact = await requireContact(r);
  const conv = await conversationFor(r, contact.id);
  const orgId = r.ex.organizationId;
  let userId: string | null = null;
  if (d.mode === "user") {
    const m = await db.organizationMember.findFirst({ where: { organizationId: orgId, userId: d.userId }, include: { user: { select: { status: true } } } });
    if (!m || m.user.status !== "active") throw new StepError("The chosen team member is no longer in this workspace.");
    userId = d.userId;
  } else {
    userId = await pickLeastBusyMember(orgId);
    if (!userId) throw new StepError("There are no agents or managers to assign to.");
  }
  const res = await systemAssign(orgId, conv.id, userId, `Automation “${r.automation.name}”`);
  return { kind: "next", output: { assignedTo: res.name, userId } };
}

async function webhookStep(r: RunCtx): Promise<Outcome> {
  const d = r.node.data as NodeDataMap["webhook"];
  let url: URL;
  try {
    url = await assertPublicHttpsUrl(d.url);
  } catch (e) {
    throw new StepError(e instanceof UnsafeUrlError ? e.message : "Invalid URL.");
  }
  const contact = await loadContact(r.ex.organizationId, r.ex.contactId);
  const body = {
    event: "automation.step",
    automation: { id: r.automation.id, name: r.automation.name },
    executionId: r.ex.id,
    test: r.ex.isTest,
    contact: contact ? { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email, tags: contact.tags, leadStatus: contact.leadStatus, customFields: contact.customFields } : null,
    trigger: { type: r.ex.triggerType, text: r.trigger.text ?? null },
    reply: r.ctx.reply ?? null,
    sentAt: new Date().toISOString(),
  };
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", "User-Agent": "MECGURA-Automations/1.0", "X-Mecgura-Idempotency-Key": `${r.ex.id}:${r.node.id}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new StepError("The webhook didn't respond (timeout or network error).", true);
  }
  const text = (await res.text().catch(() => "")).slice(0, 4000);
  if (res.status >= 200 && res.status < 300) {
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* plain text */
    }
    r.ctx.webhook = data;
    return { kind: "next", output: { status: res.status, response: text.slice(0, 500) } };
  }
  const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
  throw new StepError(`Webhook answered HTTP ${res.status}${res.status >= 300 && res.status < 400 ? " (redirects aren't followed)" : ""}.`, retryable);
}

async function aiStep(r: RunCtx): Promise<Outcome> {
  const d = r.node.data as NodeDataMap["ai_response"];
  const contact = await requireContact(r);
  const conv = await conversationFor(r, contact.id);
  const recent = await db.message.findMany({ where: { conversationId: conv.id, direction: { in: ["inbound", "outbound"] }, body: { not: "" } }, orderBy: { createdAt: "desc" }, take: 12 });
  let text: string;
  try {
    text = await generateReply({
      instructions: d.instructions,
      businessName: conv.whatsappAccount.displayName,
      history: recent.reverse().map((m) => ({ role: m.direction === "inbound" ? ("customer" as const) : ("business" as const), text: m.body })),
    });
  } catch (e) {
    throw new StepError(e instanceof AiError ? e.message : "AI request failed.", e instanceof AiError ? e.retryable : true);
  }
  r.ctx.ai = text;
  if (d.saveToField.trim()) {
    await db.contact.update({ where: { id: contact.id }, data: { customFields: JSON.stringify({ ...contact.customFields, [d.saveToField.trim()]: text.slice(0, 500) }) } });
  }
  let messageId: string | null = null;
  if (d.sendReply) {
    const windowOpen = Boolean(conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < WINDOW_MS);
    if (!windowOpen) throw new StepError("The 24-hour window is closed — AI replies can only answer recent messages.");
    messageId = await sendOutbound(r, conv, contact, { ...toPayload({ type: "text", body: text }), type: "text" });
  }
  return { kind: "next", output: { reply: text.slice(0, 500), messageId } };
}

// ---------------------------------------------------------------------------
// Scheduler: due executions (delays, reply timeouts, retries) + schedule triggers
// ---------------------------------------------------------------------------

export async function runDueAutomations(budgetMs = 40_000) {
  const started = Date.now();
  const now = new Date();
  let scheduled = 0;
  const schedules = await db.automation.findMany({ where: { status: "active", triggerType: "schedule", publishedVersionId: { not: null } } });
  const ist = istNow(now);
  for (const a of schedules) {
    const cfg = parse<TriggerData>(a.triggerConfig, {} as TriggerData);
    const s = cfg.schedule;
    if (!s || ist.time < s.time) continue;
    if (s.frequency === "weekly" && !s.days.includes(ist.weekday)) continue;
    if (a.lastScheduledAt && istNow(a.lastScheduledAt).date === ist.date) continue;
    const claimed = await db.automation.updateMany({ where: { id: a.id, lastScheduledAt: a.lastScheduledAt }, data: { lastScheduledAt: now } });
    if (!claimed.count) continue;
    const contacts = await db.contact.findMany({ where: { organizationId: a.organizationId, tags: { some: { tag: { name: s.tagName } } }, optInStatus: { not: "opted_out" }, suppressed: false }, select: { id: true }, take: 1000 });
    for (const c of contacts) {
      if (await startExecution(a, { contactId: c.id, triggerData: { type: "schedule", date: ist.date }, dedupeKey: `${a.id}:sched:${ist.date}:${c.id}` })) scheduled++;
    }
    await audit({ action: "automation.scheduled_run", organizationId: a.organizationId, targetType: "automation", targetId: a.id, metadata: { contacts: contacts.length, date: ist.date } });
  }
  const due = await db.automationExecution.findMany({
    where: { status: { in: ["queued", "running"] }, nextRunAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    select: { id: true },
    orderBy: { nextRunAt: "asc" },
    take: 100,
  });
  let ran = 0;
  for (const e of due) {
    if (Date.now() - started > budgetMs) break;
    await runExecution(e.id, Math.min(15_000, budgetMs - (Date.now() - started)));
    ran++;
  }
  return { scheduled, ran };
}
