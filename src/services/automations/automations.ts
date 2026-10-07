import { randomBytes } from "node:crypto";
import { assertAutomationSlot, assertFeature } from "@/services/billing/entitlements";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { safeEqual, sha256 } from "@/lib/crypto";
import { publish } from "@/lib/realtime/broker";
import type { OrgAccess } from "@/lib/session";
import { demoWorkflow, defaultData, validateGraph, type Graph, type TriggerData } from "@/lib/automations";
import { templateSlots } from "@/lib/templates";
import { graphSchema } from "@/lib/validations";
import { toDef } from "@/services/templates/templates";
import { startExecution } from "@/services/automations/engine";
import { createContact, normalizePhone } from "@/services/inbox/contacts";

const parse = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export function parseGraph(raw: string): Graph {
  const r = graphSchema.safeParse(parse(raw, {}));
  return r.success ? (r.data as Graph) : { nodes: [], edges: [] };
}

const BLANK: Graph = { nodes: [{ id: "trigger", type: "trigger", position: { x: 260, y: 0 }, data: { ...defaultData("trigger"), label: "Trigger" } }], edges: [] };

const include = {
  whatsappAccount: { select: { id: true, displayName: true, phoneNumber: true, isDemo: true } },
  createdBy: { select: { name: true, email: true } },
} satisfies Prisma.AutomationInclude;
type Row = Prisma.AutomationGetPayload<{ include: typeof include }>;

async function load(organizationId: string, id: string) {
  const a = await db.automation.findFirst({ where: { id, organizationId }, include });
  if (!a) throw new ApiError("NOT_FOUND", "Automation not found.");
  return a;
}

type Stats = { runs30: number; completed30: number; failed30: number; active: number };

async function stats(ids: string[]): Promise<Map<string, Stats>> {
  const out = new Map(ids.map((id) => [id, { runs30: 0, completed30: 0, failed30: 0, active: 0 }]));
  if (!ids.length) return out;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [recent, live] = await Promise.all([
    db.automationExecution.groupBy({ by: ["automationId", "status"], where: { automationId: { in: ids }, isTest: false, createdAt: { gte: since } }, _count: { _all: true } }),
    db.automationExecution.groupBy({ by: ["automationId"], where: { automationId: { in: ids }, status: { in: ["queued", "running"] } }, _count: { _all: true } }),
  ]);
  for (const g of recent) {
    const s = out.get(g.automationId)!;
    s.runs30 += g._count._all;
    if (g.status === "completed") s.completed30 += g._count._all;
    if (g.status === "failed") s.failed30 += g._count._all;
  }
  for (const g of live) out.get(g.automationId)!.active = g._count._all;
  return out;
}

function toDto(a: Row, s: Stats) {
  const graph = parseGraph(a.graph);
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    status: a.status,
    triggerType: a.triggerType || (graph.nodes.find((n) => n.type === "trigger")?.data as TriggerData | undefined)?.trigger || "",
    currentVersion: a.currentVersion,
    published: Boolean(a.publishedVersionId),
    account: a.whatsappAccount,
    settings: parse<{ reentry?: string }>(a.settings, {}),
    steps: graph.nodes.length,
    hasWebhookSecret: Boolean(a.webhookSecretHash),
    lastRunAt: a.lastRunAt,
    createdBy: a.createdBy?.name || a.createdBy?.email || null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    stats: s,
  };
}

export async function listAutomations(access: OrgAccess, f: { status?: string; q?: string }) {
  const base: Prisma.AutomationWhereInput = { organizationId: access.organizationId, ...(f.q ? { name: { contains: f.q } } : {}) };
  const [rows, grouped] = await Promise.all([
    db.automation.findMany({ where: { ...base, ...(f.status ? { status: f.status } : {}) }, include, orderBy: { updatedAt: "desc" }, take: 200 }),
    db.automation.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
  ]);
  const s = await stats(rows.map((r) => r.id));
  const counts: Record<string, number> = { all: 0 };
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.all += g._count._all;
  }
  return { automations: rows.map((r) => toDto(r, s.get(r.id)!)), counts };
}

export async function getAutomation(access: OrgAccess, id: string) {
  return getAutomationForOrg(access.organizationId, id);
}

/** For server-rendered pages that already resolved the tenant. */
export async function getAutomationForOrg(organizationId: string, id: string) {
  const a = await load(organizationId, id);
  const [s, versions] = await Promise.all([
    stats([id]),
    db.automationVersion.findMany({ where: { automationId: id }, orderBy: { version: "desc" }, take: 50, select: { id: true, version: true, note: true, createdAt: true, publishedById: true, triggerType: true } }),
  ]);
  const publishers = await db.user.findMany({ where: { id: { in: versions.map((v) => v.publishedById).filter((x): x is string => !!x) } }, select: { id: true, name: true, email: true } });
  const live = a.publishedVersionId ? await db.automationVersion.findUnique({ where: { id: a.publishedVersionId }, select: { graph: true } }) : null;
  return {
    ...toDto(a, s.get(id)!),
    graph: parseGraph(a.graph),
    publishedGraph: live ? parseGraph(live.graph) : null,
    versions: versions.map((v) => ({ ...v, publishedBy: publishers.find((p) => p.id === v.publishedById)?.name ?? null, live: v.id === a.publishedVersionId })),
    webhookUrl: `/api/automations/hooks/${a.id}`,
  };
}
export type AutomationDetail = Awaited<ReturnType<typeof getAutomation>>;

async function assertAccount(organizationId: string, id: string | null | undefined) {
  if (!id) return null;
  const a = await db.whatsAppAccount.findFirst({ where: { id, organizationId, status: { in: ["connected", "demo"] } } });
  if (!a) throw new ApiError("VALIDATION_ERROR", "Choose a connected WhatsApp number.", { details: { whatsappAccountId: ["Not connected"] } });
  return a.id;
}

export async function createAutomation(access: OrgAccess, input: { name: string; description: string; whatsappAccountId?: string | null; start: "blank" | "demo_welcome" }, req?: Request) {
  await assertFeature(access.organizationId, "automations");
  const accountId = await assertAccount(access.organizationId, input.whatsappAccountId);
  const graph = input.start === "demo_welcome" ? demoWorkflow() : BLANK;
  const a = await db.automation.create({
    data: { organizationId: access.organizationId, name: input.name, description: input.description, whatsappAccountId: accountId, graph: JSON.stringify(graph), createdById: access.user.id },
  });
  await audit({ action: "automation.created", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "automation", targetId: a.id, metadata: { name: a.name, start: input.start }, req });
  return getAutomation(access, a.id);
}

/** Saves the working draft. The live (published) version keeps running unchanged until the next publish. */
export async function updateAutomation(
  access: OrgAccess,
  id: string,
  p: Partial<{ name: string; description: string; whatsappAccountId: string | null; graph: Graph; settings: { reentry: "always" | "once" } }>,
  req?: Request
) {
  await load(access.organizationId, id);
  const data: Prisma.AutomationUncheckedUpdateInput = {};
  if (p.name !== undefined) data.name = p.name;
  if (p.description !== undefined) data.description = p.description;
  if (p.whatsappAccountId !== undefined) data.whatsappAccountId = await assertAccount(access.organizationId, p.whatsappAccountId);
  if (p.graph !== undefined) data.graph = JSON.stringify(p.graph);
  if (p.settings !== undefined) data.settings = JSON.stringify(p.settings);
  await db.automation.update({ where: { id }, data });
  await audit({ action: "automation.updated", organizationId: access.organizationId, actorUserId: access.user.id, targetType: "automation", targetId: id, metadata: { fields: Object.keys(p) }, req });
  return getAutomation(access, id);
}

/** Checks references against this workspace: templates approved, people still members. */
async function referenceProblems(organizationId: string, g: Graph) {
  const issues: { nodeId?: string; message: string }[] = [];
  for (const n of g.nodes) {
    const d = n.data as Record<string, unknown>;
    const tplId = n.type === "template" ? String(d.templateId ?? "") : n.type === "message" ? String(d.fallbackTemplateId ?? "") : n.type === "trigger" ? String(d.templateId ?? "") : "";
    if (tplId && !(n.type === "trigger" && d.trigger !== "template_reply")) {
      const t = await db.messageTemplate.findFirst({ where: { id: tplId, organizationId } });
      if (!t) issues.push({ nodeId: n.id, message: "The chosen template no longer exists." });
      else if (n.type !== "trigger" && t.status !== "approved") issues.push({ nodeId: n.id, message: `Template “${t.name}” is ${t.status} — only approved templates can be sent.` });
      else if (n.type === "message" && templateSlots(toDef(t)).some((s) => !(s.part === "body" && s.index === 1))) {
        issues.push({ nodeId: n.id, message: `Fallback template “${t.name}” can have at most one variable ({{1}} = first name).` });
      }
    }
    if (n.type === "assign" && d.mode === "user" && d.userId) {
      const m = await db.organizationMember.findFirst({ where: { organizationId, userId: String(d.userId) } });
      if (!m) issues.push({ nodeId: n.id, message: "The chosen team member isn't in this workspace." });
    }
  }
  return issues;
}

export async function publishAutomation(access: OrgAccess, id: string, note: string, req?: Request) {
  const a = await load(access.organizationId, id);
  const graph = parseGraph(a.graph);
  const { errors, warnings } = validateGraph(graph);
  errors.push(...(await referenceProblems(access.organizationId, graph)));
  if (errors.length) {
    throw new ApiError("VALIDATION_ERROR", "Fix the highlighted steps before publishing.", {
      details: Object.fromEntries(errors.map((e, i) => [e.nodeId ? `node.${e.nodeId}.${i}` : `graph.${i}`, [e.message]])),
    });
  }
  const trigger = graph.nodes.find((n) => n.type === "trigger")!.data as TriggerData;
  const version = a.currentVersion + 1;
  const v = await db.automationVersion.create({
    data: { organizationId: a.organizationId, automationId: id, version, graph: JSON.stringify(graph), triggerType: trigger.trigger, triggerConfig: JSON.stringify(trigger), note, publishedById: access.user.id },
  });
  await db.automation.update({
    where: { id },
    data: { publishedVersionId: v.id, currentVersion: version, triggerType: trigger.trigger, triggerConfig: JSON.stringify(trigger), status: a.status === "inactive" ? "inactive" : "active" },
  });
  await audit({ action: "automation.published", organizationId: a.organizationId, actorUserId: access.user.id, targetType: "automation", targetId: id, metadata: { name: a.name, version, note: note || undefined }, req });
  publish(a.organizationId, { type: "automation.updated", automationId: id });
  return { automation: await getAutomation(access, id), warnings };
}

export async function setAutomationStatus(access: OrgAccess, id: string, action: "activate" | "deactivate", req?: Request) {
  const a = await load(access.organizationId, id);
  if (action === "activate" && !a.publishedVersionId) throw new ApiError("CONFLICT", "Publish the automation before activating it.");
  if (action === "activate" && a.status !== "active") {
    await assertFeature(a.organizationId, "automations");
    await assertAutomationSlot(a.organizationId);
  }
  await db.automation.update({ where: { id }, data: { status: action === "activate" ? "active" : "inactive" } });
  await audit({ action: action === "activate" ? "automation.activated" : "automation.deactivated", organizationId: a.organizationId, actorUserId: access.user.id, targetType: "automation", targetId: id, metadata: { name: a.name }, req });
  publish(a.organizationId, { type: "automation.updated", automationId: id });
  return getAutomation(access, id);
}

export async function duplicateAutomation(access: OrgAccess, id: string, req?: Request) {
  const a = await load(access.organizationId, id);
  const copy = await db.automation.create({
    data: { organizationId: a.organizationId, name: `${a.name} (copy)`.slice(0, 120), description: a.description, whatsappAccountId: a.whatsappAccountId, graph: a.graph, settings: a.settings, createdById: access.user.id },
  });
  await audit({ action: "automation.duplicated", organizationId: a.organizationId, actorUserId: access.user.id, targetType: "automation", targetId: copy.id, metadata: { from: a.name }, req });
  return getAutomation(access, copy.id);
}

export async function deleteAutomation(access: OrgAccess, id: string, req?: Request) {
  const a = await load(access.organizationId, id);
  await db.automation.delete({ where: { id } }); // cascades: versions, executions, steps
  await audit({ action: "automation.deleted", organizationId: a.organizationId, actorUserId: access.user.id, targetType: "automation", targetId: id, metadata: { name: a.name }, req });
}

export async function restoreVersion(access: OrgAccess, id: string, versionId: string, req?: Request) {
  await load(access.organizationId, id);
  const v = await db.automationVersion.findFirst({ where: { id: versionId, automationId: id } });
  if (!v) throw new ApiError("NOT_FOUND", "Version not found.");
  return updateAutomation(access, id, { graph: parseGraph(v.graph) }, req);
}

/** Inbound-webhook trigger secret. Only its hash is stored; the value is shown once. */
export async function rotateWebhookSecret(access: OrgAccess, id: string, req?: Request) {
  const a = await load(access.organizationId, id);
  const secret = `whk_${randomBytes(24).toString("base64url")}`;
  await db.automation.update({ where: { id }, data: { webhookSecretHash: sha256(secret) } });
  await audit({ action: "automation.webhook_secret_rotated", organizationId: a.organizationId, actorUserId: access.user.id, targetType: "automation", targetId: id, req });
  return { secret, url: `/api/automations/hooks/${id}` };
}

// ---------------------------------------------------------------------------
// Test runs
// ---------------------------------------------------------------------------

export async function testAutomation(access: OrgAccess, id: string, input: { contactId: string; skipDelays: boolean }, req?: Request) {
  const a = await load(access.organizationId, id);
  const contact = await db.contact.findFirst({ where: { id: input.contactId, organizationId: access.organizationId } });
  if (!contact) throw new ApiError("VALIDATION_ERROR", "Choose a contact for the test.", { details: { contactId: ["Unknown contact"] } });
  const graph = parseGraph(a.graph);
  const { errors } = validateGraph(graph);
  errors.push(...(await referenceProblems(access.organizationId, graph)));
  if (errors.length) throw new ApiError("VALIDATION_ERROR", "Fix the highlighted steps before testing.", { details: Object.fromEntries(errors.map((e, i) => [e.nodeId ? `node.${e.nodeId}.${i}` : `graph.${i}`, [e.message]])) });
  const ex = await startExecution(a, { contactId: contact.id, triggerData: { type: "test", text: "" }, test: { graph, skipDelays: input.skipDelays } });
  if (!ex) throw new ApiError("CONFLICT", "The test couldn't start.");
  await audit({ action: "automation.test_run", organizationId: a.organizationId, actorUserId: access.user.id, targetType: "automation", targetId: id, metadata: { contactId: contact.id, skipDelays: input.skipDelays }, req });
  return { executionId: ex.id };
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export async function listExecutions(access: OrgAccess, id: string, f: { status?: string; page: number; tests: "include" | "exclude" | "only" }) {
  await load(access.organizationId, id);
  const PAGE = 25;
  const where: Prisma.AutomationExecutionWhereInput = {
    automationId: id,
    ...(f.status ? { status: f.status } : {}),
    ...(f.tests === "exclude" ? { isTest: false } : f.tests === "only" ? { isTest: true } : {}),
  };
  const [rows, total] = await Promise.all([
    db.automationExecution.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * PAGE, take: PAGE, include: { contact: { select: { id: true, name: true, phone: true } }, _count: { select: { steps: true } } } }),
    db.automationExecution.count({ where }),
  ]);
  return {
    executions: rows.map((e) => ({
      id: e.id,
      status: e.status,
      waitState: e.waitState,
      version: e.version,
      isTest: e.isTest,
      triggerType: e.triggerType,
      contact: e.contact,
      error: e.error,
      steps: e._count.steps,
      nextRunAt: e.nextRunAt,
      startedAt: e.startedAt,
      finishedAt: e.finishedAt,
      createdAt: e.createdAt,
    })),
    total,
    page: f.page,
    pageSize: PAGE,
  };
}

export async function getExecution(access: OrgAccess, executionId: string) {
  const e = await db.automationExecution.findFirst({
    where: { id: executionId, organizationId: access.organizationId },
    include: { contact: { select: { id: true, name: true, phone: true } }, steps: { orderBy: { startedAt: "asc" } } },
  });
  if (!e) throw new ApiError("NOT_FOUND", "Run not found.");
  const graph = parseGraph(e.graph);
  return {
    id: e.id,
    automationId: e.automationId,
    status: e.status,
    waitState: e.waitState,
    version: e.version,
    isTest: e.isTest,
    triggerType: e.triggerType,
    triggerData: parse<Record<string, unknown>>(e.triggerData, {}),
    contact: e.contact,
    error: e.error,
    currentNodeId: e.currentNodeId,
    nextRunAt: e.nextRunAt,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
    createdAt: e.createdAt,
    steps: e.steps.map((s) => ({
      id: s.id,
      nodeId: s.nodeId,
      nodeType: s.nodeType,
      label: (graph.nodes.find((n) => n.id === s.nodeId)?.data as { label?: string } | undefined)?.label ?? s.nodeType,
      status: s.status,
      attempt: s.attempt,
      output: parse<Record<string, unknown>>(s.output, {}),
      error: s.error,
      startedAt: s.startedAt,
    })),
  };
}

/** Stop a queued/running run, or retry a failed one from the step that failed (completed steps are not repeated). */
export async function executionAction(access: OrgAccess, executionId: string, action: "stop" | "retry", req?: Request) {
  const e = await db.automationExecution.findFirst({ where: { id: executionId, organizationId: access.organizationId } });
  if (!e) throw new ApiError("NOT_FOUND", "Run not found.");
  if (action === "stop") {
    const r = await db.automationExecution.updateMany({ where: { id: e.id, status: { in: ["queued", "running"] } }, data: { status: "stopped", finishedAt: new Date(), lockedUntil: null, nextRunAt: null, error: "Stopped by a team member." } });
    if (!r.count) throw new ApiError("CONFLICT", "Only queued or running runs can be stopped.");
    await audit({ action: "automation.execution_stopped", organizationId: e.organizationId, actorUserId: access.user.id, targetType: "automation_execution", targetId: e.id, req });
  } else {
    if (e.status !== "failed") throw new ApiError("CONFLICT", "Only failed runs can be retried.");
    const lastFailed = await db.automationExecutionStep.findFirst({ where: { executionId: e.id, status: "failed" }, orderBy: { startedAt: "desc" } });
    if (!lastFailed) throw new ApiError("CONFLICT", "There is no failed step to retry.");
    const ctx = parse<Record<string, unknown>>(e.context, {});
    await db.automationExecution.update({
      where: { id: e.id },
      data: { status: "running", currentNodeId: lastFailed.nodeId, attempts: 0, waitState: "", error: "", finishedAt: null, nextRunAt: new Date(), lockedUntil: null, context: JSON.stringify({ ...ctx, inflight: null }) },
    });
    await audit({ action: "automation.execution_retried", organizationId: e.organizationId, actorUserId: access.user.id, targetType: "automation_execution", targetId: e.id, metadata: { fromStep: lastFailed.nodeId }, req });
    const { runExecution } = await import("@/services/automations/engine");
    const { runAfterResponse } = await import("@/lib/background");
    runAfterResponse(() => runExecution(e.id));
  }
  publish(e.organizationId, { type: "automation.updated", automationId: e.automationId });
  return getExecution(access, e.id);
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

export async function automationAnalytics(access: OrgAccess, id: string) {
  await load(access.organizationId, id);
  const since = new Date(Date.now() - 14 * 86_400_000);
  const [byStatus, perNode, recent, errors, completed] = await Promise.all([
    db.automationExecution.groupBy({ by: ["status"], where: { automationId: id, isTest: false }, _count: { _all: true } }),
    db.automationExecutionStep.groupBy({ by: ["nodeId", "status"], where: { execution: { automationId: id, isTest: false } }, _count: { _all: true } }),
    db.automationExecution.findMany({ where: { automationId: id, isTest: false, createdAt: { gte: since } }, select: { createdAt: true, status: true } }),
    db.automationExecutionStep.groupBy({ by: ["error"], where: { execution: { automationId: id, isTest: false }, status: "failed", error: { not: "" } }, _count: { _all: true }, orderBy: { _count: { error: "desc" } }, take: 5 }),
    db.automationExecution.findMany({ where: { automationId: id, isTest: false, status: "completed", startedAt: { not: null }, finishedAt: { not: null } }, select: { startedAt: true, finishedAt: true }, orderBy: { finishedAt: "desc" }, take: 500 }),
  ]);
  const totals: Record<string, number> = { total: 0, queued: 0, running: 0, completed: 0, failed: 0, stopped: 0 };
  for (const g of byStatus) {
    totals[g.status] = g._count._all;
    totals.total += g._count._all;
  }
  const nodes: Record<string, Record<string, number>> = {};
  for (const g of perNode) (nodes[g.nodeId] ??= {})[g.status] = g._count._all;
  const days: { day: string; runs: number; completed: number; failed: number }[] = [];
  for (let i = 13; i >= 0; i--) days.push({ day: dayKey.format(new Date(Date.now() - i * 86_400_000)), runs: 0, completed: 0, failed: 0 });
  for (const r of recent) {
    const d = days.find((x) => x.day === dayKey.format(r.createdAt));
    if (!d) continue;
    d.runs++;
    if (r.status === "completed") d.completed++;
    if (r.status === "failed") d.failed++;
  }
  const durations = completed.map((c) => c.finishedAt!.getTime() - c.startedAt!.getTime());
  const finished = totals.completed + totals.failed + totals.stopped;
  return {
    totals,
    completionRate: finished ? Math.round((totals.completed / finished) * 1000) / 10 : 0,
    avgDurationSec: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000) : null,
    nodes,
    days,
    errors: errors.map((e) => ({ error: e.error, count: e._count._all })),
  };
}

// ---------------------------------------------------------------------------
// Inbound webhook trigger
// ---------------------------------------------------------------------------

/** POST /api/automations/hooks/:id with "Authorization: Bearer <secret>". Creates/finds the contact and starts a run. */
export async function triggerFromWebhook(automationId: string, secret: string, input: { phone: string; name: string; email: string; data: Record<string, unknown> }) {
  const a = await db.automation.findUnique({ where: { id: automationId } });
  // Same answer for unknown automation and wrong secret, so ids can't be probed.
  if (!a || !a.webhookSecretHash || !safeEqual(sha256(secret), a.webhookSecretHash)) throw new ApiError("UNAUTHENTICATED", "Invalid webhook credentials.");
  if (a.status !== "active" || a.triggerType !== "webhook") throw new ApiError("CONFLICT", "This automation isn't active with a webhook trigger.");
  const phone = normalizePhone(input.phone);
  if (!phone) throw new ApiError("VALIDATION_ERROR", "Invalid phone number.", { details: { phone: ["Use international format"] } });
  let contact = await db.contact.findUnique({ where: { organizationId_phone: { organizationId: a.organizationId, phone } } });
  if (!contact) {
    const created = await createContact({ organizationId: a.organizationId, actorUserId: null }, { phone, name: input.name, email: input.email, source: "api" });
    contact = await db.contact.findUniqueOrThrow({ where: { id: created.id } });
  }
  const ex = await startExecution(a, { contactId: contact.id, triggerData: { type: "webhook", data: input.data, text: "" } });
  return { accepted: Boolean(ex), executionId: ex?.id ?? null, reason: ex ? undefined : "A run for this contact is already in progress (or the contact can't re-enter)." };
}
