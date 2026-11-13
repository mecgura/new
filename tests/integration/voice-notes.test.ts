import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as automations from "@/app/api/organizations/[orgId]/automations/route";
import * as automation from "@/app/api/organizations/[orgId]/automations/[aid]/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/automations/[aid]/publish/route";
import { runDueAutomations } from "@/services/automations/engine";
import { receiveInbound } from "@/services/inbox/messaging";
import { toMessageDto } from "@/services/inbox/conversations";
import { transcribeAudio } from "@/providers/ai/transcribe";
import { defaultData, type FlowNode, type Graph, type NodeDataMap, type NodeType } from "@/lib/automations";

const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });
let orgId = "";
let accountId = "";
let n = 0;
const phone = () => `+9196${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;
const node = <T extends NodeType>(id: string, type: T, data: Partial<NodeDataMap[T]> = {}): FlowNode => ({ id, type, position: { x: 0, y: 0 }, data: { ...defaultData(type), ...data } as FlowNode["data"] });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

beforeAll(async () => {
  orgId = (await makeOrg("Voice Notes")).id;
  const owner = await makeUser({ name: "Owner" });
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
  await db.subscription.create({ data: { organizationId: orgId, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: orgId, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const r = await json(await demoConnect.POST(post({ businessName: "Voice Co" }), P(orgId)));
  accountId = (r.body.account as { id: string }).id;
  const c = await json(await automations.POST(post({ name: "Price", whatsappAccountId: accountId }), P(orgId)));
  const aid = (c.body.automation as { id: string }).id;
  const graph: Graph = { nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["price"], match: "contains" }), node("m", "message", { text: "Plans start at ₹999." })], edges: [{ id: "e", source: "t", target: "m", sourceHandle: null }] };
  expect((await automation.PATCH(req("/x", { method: "PATCH", body: { graph } }), P(orgId, { aid }))).status).toBe(200);
  expect((await publishRoute.POST(post({}), P(orgId, { aid }))).status).toBe(200);
});

describe("voice notes", () => {
  it("saves what was said and lets a keyword automation answer it", async () => {
    const r = await receiveInbound(orgId, accountId, {
      externalId: `v.${randomUUID()}`,
      fromPhone: phone(),
      profileName: "Simran",
      type: "audio",
      body: "",
      transcript: "bhaji website da price ki hai",
      attachments: [{ kind: "audio", mimeType: "audio/ogg", filename: "", providerMediaId: "m1", sha256: "", caption: "" }],
      at: new Date(),
      isDemo: true,
    });
    for (let i = 0; i < 30; i++) {
      const d = await runDueAutomations(20_000);
      if (!d.ran && !d.scheduled) break;
    }
    const msg = await db.message.findUniqueOrThrow({ where: { id: r!.messageId }, include: { attachments: true, sender: { select: { id: true, name: true, email: true } }, replyTo: { select: { id: true, body: true, type: true, direction: true } } } });
    expect(msg.transcript).toBe("bhaji website da price ki hai");
    expect(toMessageDto(msg).transcript).toBe("bhaji website da price ki hai");
    const out = await db.message.findMany({ where: { conversationId: r!.conversationId, direction: "outbound" } });
    expect(out.map((m) => m.body)).toContain("Plans start at ₹999.");
  });

  it("a voice note with no text is still saved as a normal message", async () => {
    const r = await receiveInbound(orgId, accountId, { externalId: `v.${randomUUID()}`, fromPhone: phone(), profileName: "Aman", type: "audio", body: "", attachments: [{ kind: "audio", mimeType: "audio/ogg", filename: "", providerMediaId: "m2", sha256: "", caption: "" }], at: new Date(), isDemo: true });
    expect((await db.message.findUniqueOrThrow({ where: { id: r!.messageId } })).transcript).toBe("");
  });

  it("asks Gemini when its key is set, else OpenAI, and returns nothing when neither is", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await transcribeAudio(Buffer.from("x"), "audio/ogg")).toBe("");
    expect(spy).not.toHaveBeenCalled();
    vi.stubEnv("GEMINI_API_KEY", "g-key");
    spy.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: " salon di booking\nkarni hai " }] } }] }), { status: 200 }));
    expect(await transcribeAudio(Buffer.from("x"), "audio/ogg; codecs=opus")).toBe("salon di booking karni hai");
    expect(String(spy.mock.calls[0][0])).toContain("generativelanguage");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "o-key");
    spy.mockResolvedValueOnce(new Response(JSON.stringify({ text: "hello ji" }), { status: 200 }));
    expect(await transcribeAudio(Buffer.from("x"), "audio/ogg")).toBe("hello ji");
    spy.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect(await transcribeAudio(Buffer.from("x"), "audio/ogg")).toBe("");
  });
});
