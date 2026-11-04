import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

// Anthropic is stubbed (no network): each test decides what it does.
const anth = vi.hoisted(() => ({ reply: null as null | ((...a: unknown[]) => Promise<string>), respond: null as null | ((...a: unknown[]) => Promise<unknown>) }));
vi.mock("@/providers/anthropic/reply", async (orig) => {
  const real = await orig<typeof import("@/providers/anthropic/reply")>();
  return { ...real, generateReply: (...a: unknown[]) => (anth.reply ? anth.reply(...a) : Promise.reject(new real.AiError("stub", false))) };
});
vi.mock("@/providers/anthropic/agent", async (orig) => {
  const real = await orig<typeof import("@/providers/anthropic/agent")>();
  return { ...real, liveRespond: (...a: unknown[]) => (anth.respond ? anth.respond(...a) : Promise.reject(new Error("stub"))) };
});
const rzSubs = vi.hoisted(() => ({ fail: "" }));
vi.mock("@/lib/razorpay", () => ({
  getRazorpay: async () => ({ mode: "test", keyId: "rzp_test", client: { orders: { all: async () => ({ items: [] }) }, subscriptions: { all: async () => { if (rzSubs.fail) throw { error: { description: rzSubs.fail } }; return { items: [] }; } } } }),
  razorpaySecretConfigured: () => true,
}));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import { resetRateLimits } from "@/lib/rate-limit";
import { AiError } from "@/providers/anthropic/reply";
import { aiCaptions, aiReply, aiRespond, providerHealth, providerOf, resetHealthCache, resolveProviders, saveAiSettings } from "@/providers/ai/router";
import { tokenCostInr } from "@/lib/ai-cost";
import { DEFAULT_ACTIONS, DEFAULT_HANDOFF, DEFAULT_KNOWLEDGE, type AgentConfig } from "@/lib/ai";
import * as agentsRoute from "@/app/api/organizations/[orgId]/ai/agents/route";
import * as testRoute from "@/app/api/organizations/[orgId]/ai/agents/[aid]/test/route";
import * as readinessRoute from "@/app/api/admin/readiness/route";
import * as verifyRoute from "@/app/api/admin/readiness/[key]/verify/route";
import * as aiSettingsRoute from "@/app/api/admin/ai/settings/route";

type Body = { model?: string; messages: { role: string; content: unknown; tool_calls?: unknown }[]; tools?: { function: { name: string; strict: boolean } }[]; response_format?: unknown };
let calls: Body[] = [];
let replies: (Record<string, unknown> | { status: number; error: string })[] = [];

function openai(content: string | null, extra: Record<string, unknown> = {}) {
  return { model: "gpt-5-mini-2026", choices: [{ finish_reason: extra.tool_calls ? "tool_calls" : "stop", message: { content, ...extra } }], usage: { prompt_tokens: 120, completion_tokens: 30 } };
}
function mockOpenAi() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof URL ? input.toString() : input);
    if (!url.startsWith("https://api.openai.com/")) return new Response("{}", { status: 404 });
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer sk-test-openai");
    calls.push(JSON.parse(String(init?.body)) as Body);
    const next = replies.shift() ?? openai("OK");
    if ("status" in next && typeof next.status === "number") return new Response(JSON.stringify({ error: { message: next.error } }), { status: next.status });
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
  });
}
const cfg = (): AgentConfig => ({ name: "Bot", businessName: "Glow Salon", instructions: "Be brief.", knowledge: { ...DEFAULT_KNOWLEDGE, faqs: [{ q: "Timings?", a: "10am to 8pm" }] }, actions: { ...DEFAULT_ACTIONS, qualify: true, transfer: true }, handoff: DEFAULT_HANDOFF, accountIds: [], documents: [] }) as unknown as AgentConfig;

beforeEach(async () => {
  calls = [];
  replies = [];
  anth.reply = null;
  anth.respond = null;
  resetRateLimits();
  resetHealthCache();
  delete process.env.ANTHROPIC_API_KEY;
  process.env.OPENAI_API_KEY = "sk-test-openai";
  await db.siteSetting.deleteMany({ where: { key: { startsWith: "ai_" } } });
  await db.siteSetting.deleteMany({ where: { key: { startsWith: "readiness:" } } });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

describe("provider selection", () => {
  it("auto uses OpenAI when only OPENAI_API_KEY is set; with no keys AI is not configured", async () => {
    expect((await resolveProviders()).primary).toBe("openai");
    delete process.env.OPENAI_API_KEY;
    expect((await resolveProviders()).primary).toBeNull();
    await expect(aiReply({ instructions: "x", businessName: "x", history: [{ role: "customer", text: "hi" }] })).rejects.toThrow(/ANTHROPIC_API_KEY or OPENAI_API_KEY/);
  });

  it("a chosen provider without a key is an error unless fallback is switched on", async () => {
    mockOpenAi();
    await saveAiSettings({ provider: "anthropic" });
    await expect(aiReply({ instructions: "x", businessName: "x", history: [{ role: "customer", text: "hi" }] })).rejects.toThrow(/Anthropic \(Claude\) is selected/);
    await saveAiSettings({ fallback: true });
    expect(await aiReply({ instructions: "x", businessName: "x", history: [{ role: "customer", text: "hi" }] })).toBe("OK");
  });

  it("falls back on an outage only when enabled, records health, and never after an action ran", async () => {
    mockOpenAi();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    await saveAiSettings({ provider: "anthropic" });
    anth.reply = async () => {
      throw new AiError("AI temporarily unavailable: overloaded", true);
    };
    await expect(aiReply({ instructions: "x", businessName: "x", history: [{ role: "customer", text: "hi" }] })).rejects.toThrow(/overloaded/);
    expect(calls).toHaveLength(0); // fallback is off by default
    await saveAiSettings({ fallback: true });
    expect(await aiReply({ instructions: "x", businessName: "x", history: [{ role: "customer", text: "hi" }] })).toBe("OK");
    expect((await providerHealth("anthropic"))?.ok).toBe(false);
    expect((await providerHealth("openai"))?.ok).toBe(true);

    // A refusal is not an outage: no fallback.
    anth.reply = async () => {
      throw new AiError("The AI declined to answer this message.", false);
    };
    calls = [];
    await expect(aiReply({ instructions: "x", businessName: "x", history: [{ role: "customer", text: "hi" }] })).rejects.toThrow(/declined/);
    expect(calls).toHaveLength(0);

    // The agent ran an action, then the provider failed: don't repeat the action on OpenAI.
    const done: string[] = [];
    anth.respond = async (...a: unknown[]) => {
      await (a[3] as (x: unknown) => Promise<string>)({ type: "qualify", status: "qualified", interest: "facial", reason: "wants to book" });
      throw new AiError("AI temporarily unavailable", true);
    };
    await expect(aiRespond(cfg(), [{ role: "customer", text: "book a facial" }], { name: "", email: "", customFields: {} }, async (x) => (done.push(x.type), "ok"))).rejects.toThrow(/temporarily/);
    expect(done).toEqual(["qualify"]);
    expect(calls).toHaveLength(0);
  });
});

describe("OpenAI provider", () => {
  it("agent: same knowledge, strict tools, tool round-trip, tokens", async () => {
    mockOpenAi();
    replies = [
      openai(null, { tool_calls: [{ id: "call_1", type: "function", function: { name: "qualify_lead", arguments: JSON.stringify({ status: "qualified", interest: "facial", reason: "asked for a slot" }) } }] }),
      openai("Sure! We're open 10am to 8pm. Shall I note a time for your facial?"),
    ];
    const done: unknown[] = [];
    const turn = await aiRespond(cfg(), [{ role: "customer", text: "Can I book a facial? what time are you open" }], { name: "Riya", email: "", customFields: {} }, async (a) => (done.push(a), "Saved."));
    expect(turn.reply).toMatch(/10am to 8pm/);
    expect(turn.actions).toEqual([{ type: "qualify", status: "qualified", interest: "facial", reason: "asked for a slot" }]);
    expect(done).toHaveLength(1);
    expect(turn).toMatchObject({ mode: "live", model: "gpt-5-mini-2026", inputTokens: 240, outputTokens: 60 });
    expect(String(calls[0].messages[0].content)).toContain("10am to 8pm"); // knowledge base in the system prompt
    expect(String(calls[0].messages[0].content)).toContain("Riya");
    expect(calls[0].tools?.map((t) => t.function.name)).toEqual(expect.arrayContaining(["qualify_lead", "transfer_to_human"]));
    expect(calls[0].tools?.every((t) => t.function.strict)).toBe(true);
    expect(calls[1].messages.at(-1)).toMatchObject({ role: "tool", content: "Saved." });
    expect(providerOf(turn.model)).toBe("openai");
    expect(tokenCostInr(turn.model, turn.inputTokens, turn.outputTokens)).toBeGreaterThan(0);
  });

  it("transfer to a human ends the turn with the handoff message", async () => {
    mockOpenAi();
    replies = [openai(null, { tool_calls: [{ id: "c", type: "function", function: { name: "transfer_to_human", arguments: '{"reason":"wants the owner"}' } }] })];
    const turn = await aiRespond(cfg(), [{ role: "customer", text: "I want to talk to the owner" }], { name: "", email: "", customFields: {} }, async () => "x");
    expect(turn.handoff).toEqual({ reason: "wants the owner" });
    expect(turn.reply).toBe(DEFAULT_HANDOFF.message);
  });

  it("maps errors: 429 is retryable, 401 is not; captions use a strict JSON schema", async () => {
    mockOpenAi();
    replies = [{ status: 429, error: "Rate limit" }];
    await expect(aiReply({ instructions: "x", businessName: "x", history: [{ role: "customer", text: "hi" }] })).rejects.toMatchObject({ retryable: true });
    replies = [{ status: 401, error: "Incorrect API key" }];
    await expect(aiReply({ instructions: "x", businessName: "x", history: [{ role: "customer", text: "hi" }] })).rejects.toMatchObject({ retryable: false });
    replies = [openai(JSON.stringify({ options: [{ caption: "Diwali glow is here ✨", hashtags: ["diwali", "#Ludhiana Salon"] }] }))];
    const c = await aiCaptions({ businessName: "Glow", brief: "Diwali facial offer", platform: "instagram", tone: "festive", language: "en", brandVoice: "", defaultHashtags: "" });
    expect(c.options[0]).toEqual({ caption: "Diwali glow is here ✨", hashtags: ["#diwali", "#LudhianaSalon"] });
    expect((calls.at(-1)!.response_format as { type: string }).type).toBe("json_schema");
  });

  it("the agent test chat runs live on OpenAI and logs model and tokens", async () => {
    mockOpenAi();
    const org = await makeOrg("OpenAI Salon");
    const owner = await makeUser({ name: "Owner" });
    await addMember(org.id, owner.id, "CLIENT_OWNER");
    await db.organizationService.create({ data: { organizationId: org.id, service: "AI_ASSISTANT", enabled: true } });
    actAs(owner);
    const a = await json(await agentsRoute.POST(req("/x", { method: "POST", body: { name: "Bot", instructions: "Be brief.", knowledge: DEFAULT_KNOWLEDGE, actions: DEFAULT_ACTIONS, handoff: DEFAULT_HANDOFF, accountIds: [] } }), params({ orgId: org.id })));
    const aid = (a.body.agent as { id: string }).id;
    replies = [openai("Hello from OpenAI")];
    const r = await json(await testRoute.POST(req("/x", { method: "POST", body: { history: [], message: "hi", mode: "live" } }), params({ orgId: org.id, aid })));
    expect(r.status).toBe(200);
    expect(r.body.turn).toMatchObject({ reply: "Hello from OpenAI", label: "Live AI (gpt-5-mini-2026)" });
    const log = await db.aiInteraction.findFirstOrThrow({ where: { agentId: aid }, orderBy: { createdAt: "desc" } });
    expect(log).toMatchObject({ model: "gpt-5-mini-2026", inputTokens: 120, outputTokens: 30, mode: "live" });
  });
});

describe("integrations readiness", () => {
  let admin: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    admin = await makeUser({ role: "SUPER_ADMIN", name: "Admin" });
  });
  const item = async (key: string) => ((await json(await readinessRoute.GET(req("/x")))).body.items as { key: string; status: string; detail: string }[]).find((i) => i.key === key)!;

  it("LIVE only after a real verification succeeds; a key alone is not LIVE", async () => {
    actAs(admin);
    expect((await item("anthropic")).status).toBe("CONFIGURATION_REQUIRED");
    expect((await item("openai")).status).toBe("CONFIGURATION_REQUIRED");
    expect((await item("openai")).detail).toMatch(/not verified/);
    mockOpenAi();
    replies = [{ status: 401, error: "Incorrect API key" }];
    const bad = await json(await verifyRoute.POST(req("/x", { method: "POST" }), params({ key: "openai" })));
    expect((bad.body.result as { ok: boolean }).ok).toBe(false);
    expect((await item("openai")).status).toBe("CONFIGURATION_REQUIRED");
    replies = [openai("OK")];
    const good = await json(await verifyRoute.POST(req("/x", { method: "POST" }), params({ key: "openai" })));
    expect((good.body.result as { ok: boolean }).ok).toBe(true);
    expect((await item("openai")).status).toBe("LIVE");
    // An old verification no longer counts.
    await db.siteSetting.update({ where: { key: "ai_health:openai" }, data: { value: JSON.stringify({ ok: true, at: new Date(Date.now() - 8 * 86_400_000).toISOString(), error: "", model: "gpt-5-mini", source: "test" }) } });
    expect((await item("openai")).status).toBe("CONFIGURATION_REQUIRED");
  });

  it("shows approval, practice, coming-soon and not-implemented items honestly", async () => {
    actAs(admin);
    const all = (await json(await readinessRoute.GET(req("/x")))).body.items as { key: string; status: string }[];
    const s = Object.fromEntries(all.map((i) => [i.key, i.status]));
    expect(s).toMatchObject({ meta_marketing: "APPROVAL_REQUIRED", gbp: "APPROVAL_REQUIRED", google_ads: "APPROVAL_REQUIRED", voice: "PRACTICE_MODE", rcs: "COMING_SOON", sms: "NOT_IMPLEMENTED", resend: "CONFIGURATION_REQUIRED", gemini: "CONFIGURATION_REQUIRED", maps: "CONFIGURATION_REQUIRED" });
    expect(all.filter((i) => i.status === "LIVE")).toHaveLength(0);
    expect(all).toHaveLength(14);
  });

  it("Razorpay Subscriptions: verified by asking Razorpay; refusal means approval required", async () => {
    actAs(admin);
    rzSubs.fail = "Subscriptions feature is not enabled for this merchant";
    await verifyRoute.POST(req("/x", { method: "POST" }), params({ key: "razorpay_subscriptions" }));
    expect((await item("razorpay_subscriptions")).status).toBe("APPROVAL_REQUIRED");
    rzSubs.fail = "";
    await verifyRoute.POST(req("/x", { method: "POST" }), params({ key: "razorpay_subscriptions" }));
    expect((await item("razorpay_subscriptions")).status).toBe("LIVE");
  });

  it("AI settings: admin only, validated, and API keys are never accepted", async () => {
    actAs(await makeUser({ name: "Client" }));
    expect((await readinessRoute.GET(req("/x"))).status).toBe(403);
    expect((await aiSettingsRoute.PUT(req("/x", { method: "PUT", body: { provider: "openai" } }))).status).toBe(403);
    actAs(admin);
    expect((await aiSettingsRoute.PUT(req("/x", { method: "PUT", body: { models: { openai: "gpt 5; drop" } } }))).status).toBe(400);
    const r = await json(await aiSettingsRoute.PUT(req("/x", { method: "PUT", body: { provider: "openai", fallback: true, models: { openai: "gpt-4.1-mini" } } })));
    expect(r.body.settings).toMatchObject({ provider: "openai", fallback: true, models: { openai: "gpt-4.1-mini" } });
    // An API key field is refused outright (keys live in Vercel env only).
    expect((await aiSettingsRoute.PUT(req("/x", { method: "PUT", body: { apiKey: "sk-should-not-be-stored" } }))).status).toBe(400);
    expect(await db.siteSetting.count({ where: { value: { contains: "sk-should-not-be-stored" } } })).toBe(0);
  });
});
