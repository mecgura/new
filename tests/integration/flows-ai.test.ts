import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Background work (the AI reply) is collected and run explicitly by the tests.
const bg = vi.hoisted(() => ({ tasks: [] as (() => Promise<unknown>)[] }));
vi.mock("@/lib/background", () => ({ runAfterResponse: (t: () => Promise<unknown>) => bg.tasks.push(t) }));

// The Anthropic SDK is replaced by a scripted fake — no network, no key needed.
const sdk = vi.hoisted(() => ({ create: null as unknown as ReturnType<typeof import("vitest").vi.fn> }));
vi.mock("@anthropic-ai/sdk", async () => {
  const { vi: v } = await import("vitest");
  sdk.create = v.fn();
  class APIError extends Error {
    status?: number;
  }
  class RateLimitError extends APIError {}
  class InternalServerError extends APIError {}
  class APIConnectionError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    static InternalServerError = InternalServerError;
    static APIConnectionError = APIConnectionError;
    beta = { messages: { create: (...a: unknown[]) => sdk.create(...a) } };
  }
  return { default: Anthropic };
});

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as demoInbound from "@/app/api/organizations/[orgId]/inbox/demo/inbound/route";
import * as messagesRoute from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/messages/route";
import * as convRoute from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/route";
import * as convAiRoute from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/ai/route";
import * as flowsRoute from "@/app/api/organizations/[orgId]/flows/route";
import * as flowRoute from "@/app/api/organizations/[orgId]/flows/[fid]/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/flows/[fid]/publish/route";
import * as demoSubmit from "@/app/api/organizations/[orgId]/flows/[fid]/demo-submit/route";
import * as submissionsRoute from "@/app/api/organizations/[orgId]/flows/[fid]/submissions/route";
import * as flowJsonRoute from "@/app/api/organizations/[orgId]/flows/[fid]/json/route";
import * as agentsRoute from "@/app/api/organizations/[orgId]/ai/agents/route";
import * as agentRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/route";
import * as agentStatus from "@/app/api/organizations/[orgId]/ai/agents/[aid]/status/route";
import * as agentDocs from "@/app/api/organizations/[orgId]/ai/agents/[aid]/documents/route";
import * as agentTest from "@/app/api/organizations/[orgId]/ai/agents/[aid]/test/route";
import * as interactionsRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/interactions/route";
import * as appointmentsRoute from "@/app/api/organizations/[orgId]/ai/appointments/route";
import * as appointmentRoute from "@/app/api/organizations/[orgId]/ai/appointments/[apid]/route";
import { handleInboundForAi } from "@/services/ai/engine";
import { optionId } from "@/lib/flows";

type U = Awaited<ReturnType<typeof makeUser>>;
type Tenant = { orgId: string; owner: U; manager: U; agent: U; accountId: string };
let n = 0;
const phone = () => `+9198${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body?: unknown) => req("/x", { method: "POST", body });
const patch = (body: unknown) => req("/x", { method: "PATCH", body });
const get = (path = "/x") => req(path);

async function flush() {
  while (bg.tasks.length) await bg.tasks.shift()!();
}

async function makeTenant(): Promise<Tenant> {
  const org = await makeOrg(`P7 ${n++}`);
  const [owner, manager, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Manager" }), makeUser({ name: "Sales Agent" })]);
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 20, maxWhatsAppNumbers: 3 });
  await db.plan.update({ where: { id: plan.id }, data: { maxContacts: 10_000 } });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const d = await json(await demoConnect.POST(post({ businessName: "Demo Clinic" }), P(org.id)));
  return { orgId: org.id, owner, manager, agent, accountId: (d.body.account as { id: string }).id };
}

async function inbound(t: Tenant, from: string, body: string) {
  const r = await json(await demoInbound.POST(post({ whatsappAccountId: t.accountId, phone: from, name: "Simran", body }), P(t.orgId)));
  expect(r.status).toBe(201);
  return r.body as { conversationId: string; contactId: string };
}
const lastOutbound = (conversationId: string) => db.message.findFirst({ where: { conversationId, direction: "outbound" }, orderBy: { createdAt: "desc" } });

let t: Tenant;
let other: Tenant;
beforeAll(async () => {
  t = await makeTenant();
  other = await makeTenant();
});
afterEach(() => {
  bg.tasks.length = 0;
  delete process.env.ANTHROPIC_API_KEY;
});

// ---------------------------------------------------------------------------

describe("WhatsApp Flows", () => {
  let flowId: string;

  it("creates a flow from a template; agents can't manage flows", async () => {
    actAs(t.owner);
    const list = await json(await flowsRoute.GET(get("/x?status=&q="), P(t.orgId)));
    const wabaId = (list.body.accounts as { id: string }[])[0].id;
    actAs(t.agent);
    expect((await flowsRoute.POST(post({ name: "Nope", wabaId, template: "lead" }), P(t.orgId))).status).toBe(403);
    actAs(t.owner);
    const c = await json(await flowsRoute.POST(post({ name: "Appointment Booking", wabaId, template: "appointment" }), P(t.orgId)));
    expect(c.status).toBe(201);
    flowId = (c.body.flow as { id: string }).id;
    const dup = await json(await flowsRoute.POST(post({ name: "Appointment Booking", wabaId, template: "lead" }), P(t.orgId)));
    expect(dup.status).toBe(409);
    for (const template of ["lead", "product", "feedback", "order"]) {
      expect((await flowsRoute.POST(post({ name: `T ${template}`, wabaId, template }), P(t.orgId))).status).toBe(201);
    }
  });

  it("is invisible to other workspaces", async () => {
    actAs(other.owner);
    expect((await flowRoute.GET(get(), P(other.orgId, { fid: flowId }))).status).toBe(404);
    expect((await flowRoute.GET(get(), P(t.orgId, { fid: flowId }))).status).toBe(403);
  });

  it("can't be sent or demo-submitted before publishing", async () => {
    actAs(t.owner);
    expect((await demoSubmit.POST(post({ phone: phone(), answers: {} }), P(t.orgId, { fid: flowId }))).status).toBe(409);
  });

  it("publishes in demo mode and exposes the generated Flow JSON", async () => {
    actAs(t.owner);
    const p = await json(await publishRoute.POST(post(), P(t.orgId, { fid: flowId })));
    expect(p.status).toBe(200);
    expect(p.body.flow).toMatchObject({ status: "published", isDemo: true });
    expect(String((p.body.flow as { metaStatus: string }).metaStatus)).toMatch(/demo/i);
    const j = await json(await flowJsonRoute.GET(get(), P(t.orgId, { fid: flowId })));
    expect(j.status).toBe(200);
    expect(JSON.stringify(j.body)).toContain("SCREEN_A");
    // Published flows are read-only.
    expect((await flowRoute.PATCH(patch({ name: "Renamed" }), P(t.orgId, { fid: flowId }))).status).toBe(409);
  });

  it("a submission saves answers and updates the CRM (contact, tags, appointment, note, thank-you)", async () => {
    actAs(t.owner);
    const from = phone();
    // Customer writes first so the 24h window is open for the thank-you.
    const { conversationId, contactId } = await inbound(t, from, "hello");
    await flush();
    const bad = await json(await demoSubmit.POST(post({ phone: from, answers: { service: "x" } }), P(t.orgId, { fid: flowId })));
    expect(bad.status).toBe(400);
    const r = await json(
      await demoSubmit.POST(
        post({ phone: from, name: "Simran", answers: { service: optionId("Website design", 1), preferred_date: "2026-10-20", time_slot: "Evening (4–7)", full_name: "Simran Kaur", email: "simran@example.com", notes: "Need a clinic site" } }),
        P(t.orgId, { fid: flowId })
      )
    );
    expect(r.status).toBe(201);
    const sub = await db.flowSubmission.findUniqueOrThrow({ where: { id: r.body.submissionId as string } });
    expect(sub).toMatchObject({ flowId, contactId, conversationId, source: "demo" });
    expect(JSON.parse(sub.answers)).toMatchObject({ service: "Website design", full_name: "Simran Kaur" });
    const crm = JSON.parse(sub.crmResult) as { updated: string[]; errors: string[]; appointmentId: string; thankYou: string };
    expect(crm.errors).toEqual([]);
    expect(crm.updated).toEqual(expect.arrayContaining(["name", "email", "notes", "leadStatus"]));
    const contact = await db.contact.findUniqueOrThrow({ where: { id: contactId }, include: { tags: { include: { tag: true } }, notes: true } });
    expect(contact).toMatchObject({ name: "Simran Kaur", email: "simran@example.com", leadStatus: "contacted" });
    expect(contact.tags.map((x) => x.tag.name)).toContain("Appointment request");
    expect(contact.notes.some((x) => x.body.includes("Appointment Booking"))).toBe(true);
    const appt = await db.appointment.findUniqueOrThrow({ where: { id: crm.appointmentId } });
    expect(appt).toMatchObject({ service: "Website design", source: "flow", status: "requested" });
    expect(appt.requestedFor).toContain("2026-10-20");
    expect((await lastOutbound(conversationId))?.body).toContain("We've received your request");
    const subs = await json(await submissionsRoute.GET(get("/x?page=1"), P(t.orgId, { fid: flowId })));
    expect(subs.status).toBe(200);
    expect((subs.body.submissions as unknown[]).length).toBe(1);
  });

  it("can be sent from the inbox as an interactive flow message", async () => {
    actAs(t.owner);
    const { conversationId } = await inbound(t, phone(), "send me the form");
    await flush();
    const r = await json(await messagesRoute.POST(post({ type: "flow", flowId }), P(t.orgId, { cid: conversationId })));
    expect(r.status).toBe(201);
    expect(r.body.message).toMatchObject({ type: "flow", payload: { flowId, flowName: "Appointment Booking" } });
    expect(String((r.body.message as { payload: { flowToken: string } }).payload.flowToken)).toMatch(new RegExp(`^mf\\.${flowId}\\.`));
    // Another workspace's flow can't be sent.
    actAs(other.owner);
    const { conversationId: oc } = await inbound(other, phone(), "hi");
    expect((await messagesRoute.POST(post({ type: "flow", flowId }), P(other.orgId, { cid: oc }))).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

const agentBody = {
  name: "Clinic assistant",
  instructions: "Be brief and friendly.",
  knowledge: {
    faqs: [{ q: "What are your clinic timings?", a: "We're open 10am–7pm, Monday to Saturday." }],
    products: [],
    services: [{ name: "Whitening", description: "One sitting", price: "₹6,000" }],
    pricing: "Consultation is free.",
  },
  actions: { answer: true, qualify: true, collect: true, collectFields: ["name", "email", "city"], book: true, bookingServices: ["Whitening", "Cleaning"], transfer: true, summarize: true },
  handoff: { keywords: ["human", "agent"], assign: "auto", userId: "", message: "Connecting you with our team.", resume: "manual", resumeAfterHours: 24 },
};

describe("AI agent", () => {
  let agentId: string;

  it("only owners/managers manage agents; other workspaces can't see them", async () => {
    actAs(t.agent);
    expect((await agentsRoute.POST(post(agentBody), P(t.orgId))).status).toBe(403);
    expect((await agentsRoute.GET(get(), P(t.orgId))).status).toBe(200);
    actAs(t.manager);
    const c = await json(await agentsRoute.POST(post(agentBody), P(t.orgId)));
    expect(c.status).toBe(201);
    agentId = (c.body.agent as { id: string }).id;
    expect(c.body.agent).toMatchObject({ status: "draft", name: "Clinic assistant" });
    actAs(other.owner);
    expect((await agentRoute.GET(get(), P(other.orgId, { aid: agentId }))).status).toBe(404);
    expect((await agentStatus.POST(post({ status: "active" }), P(other.orgId, { aid: agentId }))).status).toBe(404);
  });

  it("reports demo mode when no API key is configured", async () => {
    actAs(t.owner);
    const l = await json(await agentsRoute.GET(get(), P(t.orgId)));
    expect(l.body.liveConfigured).toBe(false);
    const live = await json(await agentTest.POST(post({ message: "hi", mode: "live" }), P(t.orgId, { aid: agentId })));
    expect(live.status).toBe(409);
    const demo = await json(await agentTest.POST(post({ message: "what are your timings?", mode: "demo" }), P(t.orgId, { aid: agentId })));
    expect(demo.status).toBe(200);
    expect(demo.body.turn).toMatchObject({ mode: "demo", label: "Demo AI — rule-based, not production AI" });
    expect((demo.body.turn as { reply: string }).reply).toContain("10am–7pm");
  });

  it("accepts plain-text documents only", async () => {
    actAs(t.owner);
    const okDoc = await json(await agentDocs.POST(post({ name: "Policy", content: "Refunds within 7 days." }), P(t.orgId, { aid: agentId })));
    expect(okDoc.status).toBe(201);
    const form = new FormData();
    form.set("file", new File(["%PDF-1.4"], "brochure.pdf", { type: "application/pdf" }));
    const pdf = await json(await agentDocs.POST(new Request("http://localhost:3000/x", { method: "POST", body: form, headers: { host: "localhost:3000" } }), P(t.orgId, { aid: agentId })));
    expect(pdf.status).toBe(400);
    expect(String(pdf.body.error)).toMatch(/plain-text/);
  });

  it("does nothing while in draft", async () => {
    actAs(t.owner);
    const { conversationId } = await inbound(t, phone(), "what are your timings?");
    await flush();
    expect(await lastOutbound(conversationId)).toBeNull();
  });

  it("demo AI answers on demo numbers, collects info, books, and labels everything", async () => {
    actAs(t.owner);
    expect((await agentStatus.POST(post({ status: "active" }), P(t.orgId, { aid: agentId }))).status).toBe(200);
    const from = phone();
    const { conversationId, contactId } = await inbound(t, from, "what are your timings?");
    await flush();
    const reply = await lastOutbound(conversationId);
    expect(reply?.body).toContain("10am–7pm");
    expect(JSON.parse(reply!.payload)).toMatchObject({ origin: "ai_demo", agentId, label: "Demo AI — rule-based, not production AI" });
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conversationId } })).aiStatus).toBe("active");

    await inbound(t, from, "my name is Simran Kaur, email simran@example.com");
    await flush();
    expect(await db.contact.findUniqueOrThrow({ where: { id: contactId } })).toMatchObject({ name: "Simran Kaur", email: "simran@example.com" });

    await inbound(t, from, "Please book whitening tomorrow 5pm");
    await flush();
    const appt = await db.appointment.findFirstOrThrow({ where: { organizationId: t.orgId, contactId, source: "ai" } });
    expect(appt).toMatchObject({ service: "Whitening", requestedFor: "tomorrow 5pm", status: "requested" });
    expect(await db.contact.findUniqueOrThrow({ where: { id: contactId } })).toMatchObject({ leadStatus: "qualified" });

    const log = await json(await interactionsRoute.GET(get("/x?page=1&pageSize=20"), P(t.orgId, { aid: agentId })));
    const rows = log.body.interactions as { mode: string; kind: string }[];
    expect(rows.filter((r) => r.mode === "demo" && r.kind === "reply").length).toBeGreaterThanOrEqual(3);
    // Demo replies don't count as AI usage.
    expect(await db.usageCounter.count({ where: { organizationId: t.orgId, metric: "ai_replies" } })).toBe(0);

    const a = await json(await appointmentsRoute.GET(get("/x?status=requested"), P(t.orgId)));
    expect((a.body.appointments as { id: string }[]).some((x) => x.id === appt.id)).toBe(true);
    actAs(t.agent);
    const u = await json(await appointmentRoute.PATCH(patch({ status: "confirmed" }), P(t.orgId, { apid: appt.id })));
    expect(u.body.appointment).toMatchObject({ status: "confirmed" });
    actAs(other.owner);
    expect((await appointmentRoute.PATCH(patch({ status: "cancelled" }), P(other.orgId, { apid: appt.id }))).status).toBe(404);
  });

  it("only one active agent per number", async () => {
    actAs(t.owner);
    const c = await json(await agentsRoute.POST(post({ ...agentBody, name: "Second" }), P(t.orgId)));
    const second = (c.body.agent as { id: string }).id;
    expect((await agentStatus.POST(post({ status: "active" }), P(t.orgId, { aid: second }))).status).toBe(409);
    expect((await agentRoute.DELETE(req("/x", { method: "DELETE" }), P(t.orgId, { aid: second }))).status).toBe(200);
  });

  it("hands off on request: AI stops, chat assigned, team notified, summary left", async () => {
    actAs(t.owner);
    const from = phone();
    const { conversationId } = await inbound(t, from, "hi, what are your timings");
    await flush();
    await inbound(t, from, "I want to talk to a human");
    await flush();
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conv.aiStatus).toBe("handoff");
    expect(conv.assignedToUserId).toBe(t.agent.id); // least busy agent
    expect((await lastOutbound(conversationId))?.body).toBe("Connecting you with our team.");
    expect(await db.notification.count({ where: { userId: t.agent.id, link: `/inbox?c=${conversationId}` } })).toBeGreaterThan(0);
    const notes = await db.message.findMany({ where: { conversationId, direction: "internal" } });
    expect(notes.some((m) => m.body.startsWith("[Demo summary"))).toBe(true);
    expect(notes.some((m) => m.body.includes("handed this chat to the team"))).toBe(true);

    // AI stays quiet afterwards.
    const before = await db.message.count({ where: { conversationId, direction: "outbound" } });
    await inbound(t, from, "what are your timings?");
    await flush();
    expect(await db.message.count({ where: { conversationId, direction: "outbound" } })).toBe(before);

    // Manual resume (configured "manual") hands it back; the AI answers again.
    actAs(t.agent);
    const st = await json(await convAiRoute.GET(get(), P(t.orgId, { cid: conversationId })));
    expect(st.body.ai).toMatchObject({ status: "handoff", mode: "demo", agent: { id: agentId, resume: "manual" } });
    const r = await json(await convAiRoute.POST(post({ action: "resume" }), P(t.orgId, { cid: conversationId })));
    expect(r.status).toBe(200);
    const after = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(after).toMatchObject({ aiStatus: "", assignedToUserId: null });
    await inbound(t, from, "what are your timings?");
    await flush();
    expect((await lastOutbound(conversationId))?.body).toContain("10am–7pm");
  });

  it("a teammate replying makes the AI step back; on_close resumes it", async () => {
    actAs(t.owner);
    await agentRoute.PATCH(patch({ handoff: { ...agentBody.handoff, resume: "on_close" } }), P(t.orgId, { aid: agentId }));
    const from = phone();
    const { conversationId } = await inbound(t, from, "hello");
    await flush();
    expect((await messagesRoute.POST(post({ type: "text", body: "Hi, Priya here from the clinic." }), P(t.orgId, { cid: conversationId }))).status).toBe(201);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conversationId } })).aiStatus).toBe("handoff");
    await inbound(t, from, "what are your timings?");
    await flush();
    expect((await lastOutbound(conversationId))?.body).toBe("Hi, Priya here from the clinic.");
    expect((await convRoute.PATCH(patch({ status: "closed" }), P(t.orgId, { cid: conversationId }))).status).toBe(200);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: conversationId } })).aiStatus).toBe("");
  });

  it("never answers a live number with demo AI", async () => {
    const from = phone();
    const { conversationId, contactId } = await inbound(t, from, "hello");
    bg.tasks.length = 0;
    await db.whatsAppAccount.update({ where: { id: t.accountId }, data: { isDemo: false } });
    try {
      const r = await handleInboundForAi(t.orgId, { conversationId, contactId, whatsappAccountId: t.accountId, messageId: "m", type: "text", text: "what are your timings?", optOut: false, automationHandled: false });
      expect(r.status).toBe("not_configured");
      const skipped = await db.aiInteraction.findFirstOrThrow({ where: { conversationId, kind: "skipped" } });
      expect(skipped.error).toMatch(/ANTHROPIC_API_KEY/);
    } finally {
      await db.whatsAppAccount.update({ where: { id: t.accountId }, data: { isDemo: true } });
    }
  });

  it("stays quiet for STOP and when an automation took the message", async () => {
    const { conversationId, contactId } = await inbound(t, phone(), "hello");
    await flush();
    const base = { conversationId, contactId, whatsappAccountId: t.accountId, messageId: "m", type: "text", text: "timings?" };
    expect((await handleInboundForAi(t.orgId, { ...base, optOut: true, automationHandled: false })).status).toBe("not_applicable");
    expect((await handleInboundForAi(t.orgId, { ...base, optOut: false, automationHandled: true })).status).toBe("automation_handled");
  });

  it("live AI (Claude) uses tools, updates the CRM and counts usage", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    sdk.create.mockReset();
    sdk.create
      .mockResolvedValueOnce({
        model: "claude-opus-5-5",
        stop_reason: "tool_use",
        usage: { input_tokens: 500, output_tokens: 40 },
        content: [
          { type: "tool_use", id: "tu1", name: "save_contact_info", input: { fields: [{ field: "email", value: "live@example.com" }, { field: "city", value: "Amritsar" }] } },
          { type: "tool_use", id: "tu2", name: "qualify_lead", input: { status: "qualified", interest: "whitening", reason: "wants a price" } },
        ],
      })
      .mockResolvedValueOnce({ model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 600, output_tokens: 30 }, content: [{ type: "text", text: "Whitening is ₹6,000. Shall I book a slot?" }] });
    const { conversationId, contactId } = await inbound(t, phone(), "whitening price? I'm in Amritsar, live@example.com");
    await flush();
    const reply = await lastOutbound(conversationId);
    expect(reply?.body).toBe("Whitening is ₹6,000. Shall I book a slot?");
    expect(JSON.parse(reply!.payload)).toMatchObject({ origin: "ai" });
    const c = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
    expect(c).toMatchObject({ email: "live@example.com", leadStatus: "qualified" });
    expect(JSON.parse(c.customFields)).toMatchObject({ city: "Amritsar" });
    // Second request carried the assistant turn unchanged plus both tool results.
    const second = sdk.create.mock.calls[1][0] as { messages: { role: string; content: unknown }[]; system: { cache_control?: unknown }[]; model: string };
    expect(second.model).toBe("claude-opus-5-5");
    expect(second.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(second.messages.at(-2)?.role).toBe("assistant");
    expect((second.messages.at(-1)?.content as { tool_use_id: string }[]).map((r) => r.tool_use_id)).toEqual(["tu1", "tu2"]);
    expect(await db.usageCounter.findFirst({ where: { organizationId: t.orgId, metric: "ai_replies" } })).toMatchObject({ value: 1 });
    const row = await db.aiInteraction.findFirstOrThrow({ where: { conversationId, kind: "reply" } });
    expect(row).toMatchObject({ mode: "live", model: "claude-opus-5-5", inputTokens: 1100, outputTokens: 70 });
  });

  it("live AI transfer and refusal both hand the chat to people", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    sdk.create.mockReset();
    sdk.create
      .mockResolvedValueOnce({ model: "claude-opus-5-5", stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", id: "x", name: "transfer_to_human", input: { reason: "Customer is upset about billing" } }] })
      .mockResolvedValueOnce({ model: "claude-opus-5-5", stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "- Upset about billing\n- Wants a call" }] });
    const a = await inbound(t, phone(), "this bill is wrong!!");
    await flush();
    const ca = await db.conversation.findUniqueOrThrow({ where: { id: a.conversationId } });
    expect(ca).toMatchObject({ aiStatus: "handoff", aiHandoffReason: "Customer is upset about billing" });
    expect((await lastOutbound(a.conversationId))?.body).toBe("Connecting you with our team.");
    expect(await db.message.count({ where: { conversationId: a.conversationId, direction: "internal", body: { contains: "🤖 AI summary" } } })).toBe(1);

    sdk.create.mockReset();
    sdk.create.mockResolvedValueOnce({ model: "claude-opus-5-5", stop_reason: "refusal", usage: { input_tokens: 10, output_tokens: 0 }, content: [] });
    const b = await inbound(t, phone(), "something odd");
    await flush();
    expect((await db.conversation.findUniqueOrThrow({ where: { id: b.conversationId } })).aiStatus).toBe("handoff");
    expect(await db.aiInteraction.findFirst({ where: { conversationId: b.conversationId, kind: "error" } })).toMatchObject({ error: "The AI declined to answer this message." });
    expect(await lastOutbound(b.conversationId)).toBeNull();
  });
});
