import { z } from "zod";
import type { AiTestCase } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { incrementUsage } from "@/lib/services/usage";
import type { OrgAccess } from "@/lib/session";
import { demoRespond, type AiAction, type AiTurn } from "@/lib/ai";
import { AiError, aiConfigured } from "@/providers/anthropic/reply";
import { aiRespond } from "@/providers/ai/router";
import { agentConfig } from "@/services/ai/agents";
import { assertServiceEnabled } from "@/services/whatsapp/guards";

/**
 * Automated tests for an AI agent ("evals"). Each case is a customer message plus rules a good answer must follow.
 * Runs use the same engine as the test chat: nothing is sent to WhatsApp and no CRM record changes. Live runs use
 * the real provider (and count as AI replies); demo runs use the rule-based engine and are labelled as such.
 */
export const MAX_CASES = 30;
export const ACTIONS = ["", "none", "collect", "qualify", "book", "transfer"] as const;

export const testCaseSchema = z.object({
  name: z.string().trim().min(1, "Name the test").max(80),
  message: z.string().trim().min(1, "Write the customer's message").max(1000),
  mustInclude: z.string().max(1000).default(""),
  mustNotInclude: z.string().max(1000).default(""),
  expectAction: z.enum(ACTIONS).default(""),
});
export type TestCaseInput = z.infer<typeof testCaseSchema>;

const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 20);

/** Pure check of one reply against a case's rules. */
export function evaluate(c: Pick<AiTestCase, "mustInclude" | "mustNotInclude" | "expectAction">, turn: Pick<AiTurn, "reply" | "actions" | "handoff">): string[] {
  const reasons: string[] = [];
  const text = turn.reply.toLowerCase();
  for (const p of lines(c.mustInclude)) if (!text.includes(p.toLowerCase())) reasons.push(`Missing “${p}”`);
  for (const p of lines(c.mustNotInclude)) if (text.includes(p.toLowerCase())) reasons.push(`Contains “${p}”, which it must not`);
  const types = turn.actions.map((a: AiAction) => a.type);
  if (c.expectAction === "none" && types.length) reasons.push(`Expected no action, got ${types.join(", ")}`);
  else if (c.expectAction && c.expectAction !== "none" && !types.includes(c.expectAction as AiAction["type"])) reasons.push(`Expected the “${c.expectAction}” action${types.length ? `, got ${types.join(", ")}` : ", none happened"}`);
  return reasons;
}

async function agentOf(organizationId: string, agentId: string) {
  const agent = await db.aiAgent.findFirst({ where: { id: agentId, organizationId } });
  if (!agent) throw new ApiError("NOT_FOUND", "AI agent not found.");
  return agent;
}

export const caseDto = (c: AiTestCase) => ({ ...c, lastReasons: JSON.parse(c.lastReasons || "[]") as string[] });

export async function listCases(organizationId: string, agentId: string) {
  await agentOf(organizationId, agentId);
  const cases = await db.aiTestCase.findMany({ where: { agentId, organizationId }, orderBy: { createdAt: "asc" } });
  const ran = cases.filter((c) => c.lastStatus);
  return { cases: cases.map(caseDto), summary: { total: cases.length, passed: ran.filter((c) => c.lastStatus === "pass").length, failed: ran.filter((c) => c.lastStatus !== "pass").length, notRun: cases.length - ran.length }, liveAvailable: aiConfigured() };
}

export async function createCase(access: OrgAccess, agentId: string, input: TestCaseInput) {
  await agentOf(access.organizationId, agentId);
  if ((await db.aiTestCase.count({ where: { agentId } })) >= MAX_CASES) throw new ApiError("CONFLICT", `Up to ${MAX_CASES} tests per agent.`);
  return caseDto(await db.aiTestCase.create({ data: { ...input, organizationId: access.organizationId, agentId } }));
}

export async function updateCase(access: OrgAccess, agentId: string, id: string, input: TestCaseInput) {
  const c = await db.aiTestCase.findFirst({ where: { id, agentId, organizationId: access.organizationId } });
  if (!c) throw new ApiError("NOT_FOUND", "Test not found.");
  return caseDto(await db.aiTestCase.update({ where: { id }, data: { ...input, lastStatus: "", lastReasons: "[]" } }));
}

export async function deleteCase(access: OrgAccess, agentId: string, id: string) {
  const r = await db.aiTestCase.deleteMany({ where: { id, agentId, organizationId: access.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Test not found.");
}

/** Runs all (or some) cases against the agent's current saved settings. */
export async function runCases(access: OrgAccess, agentId: string, input: { mode: "live" | "demo"; ids?: string[] }) {
  await assertServiceEnabled(access.organizationId, "AI_ASSISTANT");
  const agent = await agentOf(access.organizationId, agentId);
  if (input.mode === "live" && !aiConfigured()) throw new ApiError("CONFLICT", "Live AI isn't configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY). Run the tests in demo mode.");
  const cases = await db.aiTestCase.findMany({ where: { agentId, organizationId: access.organizationId, ...(input.ids?.length ? { id: { in: input.ids } } : {}) }, orderBy: { createdAt: "asc" } });
  if (!cases.length) throw new ApiError("CONFLICT", "Add a test first.");
  const cfg = await agentConfig(agent);
  const known = { name: "", email: "", customFields: {} };
  let passed = 0;
  for (const c of cases) {
    let status = "pass";
    let reasons: string[] = [];
    let reply = "";
    let model = "";
    try {
      const turn = input.mode === "live" ? await aiRespond(cfg, [{ role: "customer", text: c.message }], known, async (a) => (a.type === "book" ? "Appointment request noted (test — nothing saved)." : "Noted (test — nothing saved).")) : demoRespond(cfg, c.message, known);
      if (turn.mode === "live") await incrementUsage(access.organizationId, "ai_replies");
      reply = turn.reply;
      model = turn.model;
      reasons = evaluate(c, turn);
      status = reasons.length ? "fail" : "pass";
      await db.aiInteraction.create({ data: { organizationId: access.organizationId, agentId, mode: turn.mode, kind: turn.handoff ? "handoff" : "reply", input: c.message.slice(0, 4000), output: reply.slice(0, 4000), actions: JSON.stringify(turn.actions), model, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, isTest: true } });
    } catch (e) {
      status = "error";
      reasons = [e instanceof AiError ? e.message : "AI request failed."];
    }
    if (status === "pass") passed++;
    await db.aiTestCase.update({ where: { id: c.id }, data: { lastStatus: status, lastReply: reply.slice(0, 4000), lastReasons: JSON.stringify(reasons), lastMode: input.mode, lastModel: model, lastRunAt: new Date() } });
  }
  await audit({ action: "ai.tests_run", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "ai_agent", targetId: agentId, metadata: { mode: input.mode, total: cases.length, passed } });
  return listCases(access.organizationId, agentId);
}
