import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import { ingestWebhook } from "@/services/whatsapp";
import * as calls from "@/app/api/organizations/[orgId]/calls/route";
import * as callRoute from "@/app/api/organizations/[orgId]/calls/[callId]/route";
import * as answerRoute from "@/app/api/organizations/[orgId]/calls/[callId]/answer/route";
import * as endRoute from "@/app/api/organizations/[orgId]/calls/[callId]/end/route";
import * as permissionRoute from "@/app/api/organizations/[orgId]/calls/permission/route";
import * as callingRoute from "@/app/api/organizations/[orgId]/whatsapp/accounts/[accountId]/calling/route";

const SECRET = "test-app-secret-calls";
const SDP = "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const post = (body?: unknown) => req("/x", { method: "POST", body });
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });

let orgId: string;
let owner: Awaited<ReturnType<typeof makeUser>>;
let agent: Awaited<ReturnType<typeof makeUser>>;
let accountId: string;
let wabaId: string;
let conversationId: string;
const PNID = `pn${Date.now()}`;
const CUSTOMER = "919811122200";

type Call = { url: string; body: Record<string, unknown> | undefined };
function meta(calls: Call[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, body });
    const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/calls") && body?.action === "connect") return reply({ messaging_product: "whatsapp", calls: [{ id: "wacid.OUT1" }] });
    if (url.endsWith("/messages")) return reply({ messages: [{ id: "wamid.PERM" }] });
    return reply({ success: true });
  });
}

async function hook(value: Record<string, unknown>, field = "calls") {
  const raw = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: PNID }, ...value } }] }] }));
  const sig = `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
  return ingestWebhook(raw, sig);
}

beforeAll(async () => {
  vi.stubEnv("META_APP_SECRET", SECRET);
  orgId = (await makeOrg("Call Shop")).id;
  [owner, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 5 });
  await db.plan.update({ where: { id: plan.id }, data: { features: JSON.stringify(["campaigns", "automations", "calling"]) } });
  await db.subscription.create({ data: { organizationId: orgId, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: orgId, service: "WHATSAPP_AUTOMATION", enabled: true } });
  wabaId = `waba${Date.now()}`;
  const waba = await db.whatsAppBusinessAccount.create({ data: { organizationId: orgId, wabaId, name: "Shop" } });
  const conn = await db.whatsAppConnection.create({ data: { organizationId: orgId, method: "manual", status: "active", wabaRecordId: waba.id, encryptedAccessToken: encryptSecret("EAAtoken") } });
  const acct = await db.whatsAppAccount.create({ data: { organizationId: orgId, displayName: "Shop", phoneNumber: `+9177${String(Date.now()).slice(-8)}`, status: "connected", phoneNumberId: PNID, wabaRecordId: waba.id, connectionId: conn.id } });
  accountId = acct.id;
  const contact = await db.contact.create({ data: { organizationId: orgId, phone: `+${CUSTOMER}`, name: "Neha" } });
  conversationId = (await db.conversation.create({ data: { organizationId: orgId, contactId: contact.id, whatsappAccountId: accountId, lastInboundAt: new Date() } })).id;
});
afterEach(() => vi.restoreAllMocks());

describe("WhatsApp calling", () => {
  it("only the owner switches calling on, and Meta's setting is updated", async () => {
    const sent: Call[] = [];
    meta(sent);
    actAs(agent);
    expect((await callingRoute.PUT(req("/x", { method: "PUT", body: { enabled: true } }), P(orgId, { accountId }))).status).toBe(403);
    actAs(owner);
    const r = await json(await callingRoute.PUT(req("/x", { method: "PUT", body: { enabled: true } }), P(orgId, { accountId })));
    expect(r.status).toBe(200);
    expect(sent[0].url).toContain(`${PNID}/settings`);
    expect((sent[0].body!.calling as { status: string }).status).toBe("ENABLED");
    expect((await db.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } })).callingEnabled).toBe(true);
  });

  it("a customer's call rings, one agent answers with an SDP answer, and the end is logged", async () => {
    const sent: Call[] = [];
    meta(sent);
    const r = await hook({ contacts: [{ wa_id: CUSTOMER, profile: { name: "Neha" } }], calls: [{ id: "wacid.IN1", from: CUSTOMER, to: "917700000000", event: "connect", direction: "USER_INITIATED", session: { sdp_type: "offer", sdp: SDP } }] });
    expect(r.ok).toBe(true);
    actAs(agent);
    const live = await json(await calls.GET(req("/x"), P(orgId)));
    const ring = (live.body.calls as { id: string; status: string; offerSdp: string; peerName: string }[])[0];
    expect(ring).toMatchObject({ status: "ringing", peerName: "Neha" });
    expect(ring.offerSdp).toContain("v=0");

    const ans = await json(await answerRoute.POST(post({ sdp: SDP }), P(orgId, { callId: ring.id })));
    expect(ans.status).toBe(200);
    expect(sent.map((c) => c.body?.action)).toEqual(["pre_accept", "accept"]);
    // A second agent can't take the same call.
    actAs(owner);
    expect((await answerRoute.POST(post({ sdp: SDP }), P(orgId, { callId: ring.id }))).status).toBe(409);

    await hook({ calls: [{ id: "wacid.IN1", from: CUSTOMER, event: "terminate", status: "COMPLETED", duration: 75 }] });
    const done = await db.waCall.findUniqueOrThrow({ where: { metaCallId: "wacid.IN1" } });
    expect(done).toMatchObject({ status: "ended", durationSec: 75, answeredByUserId: agent.id });
    expect(await db.message.count({ where: { conversationId, type: "system", body: { contains: "1:15" } } })).toBe(1);
  });

  it("an unanswered customer call becomes a missed call", async () => {
    meta([]);
    await hook({ calls: [{ id: "wacid.IN2", from: CUSTOMER, event: "connect", session: { sdp_type: "offer", sdp: SDP } }] });
    await hook({ calls: [{ id: "wacid.IN2", from: CUSTOMER, event: "terminate", status: "COMPLETED" }] });
    expect((await db.waCall.findUniqueOrThrow({ where: { metaCallId: "wacid.IN2" } })).status).toBe("missed");
  });

  it("an agent calls a customer; Meta's answer SDP arrives by webhook; hanging up terminates", async () => {
    const sent: Call[] = [];
    meta(sent);
    actAs(agent);
    const r = await json(await calls.POST(post({ conversationId, sdp: SDP }), P(orgId)));
    expect(r.status).toBe(201);
    const id = (r.body.call as { id: string }).id;
    expect(sent[0].body).toMatchObject({ action: "connect", to: CUSTOMER, session: { sdp_type: "offer" } });
    expect((await calls.POST(post({ conversationId, sdp: SDP }), P(orgId))).status).toBe(409); // already on a call

    await hook({ statuses: [{ id: "wacid.OUT1", type: "call", status: "RINGING", recipient_id: CUSTOMER }] });
    await hook({ calls: [{ id: "wacid.OUT1", to: CUSTOMER, event: "connect", session: { sdp_type: "answer", sdp: SDP } }] });
    const c = await json(await callRoute.GET(req("/x"), P(orgId, { callId: id })));
    expect(c.body.call).toMatchObject({ status: "active" });
    expect((c.body.call as { answerSdp: string }).answerSdp).toContain("v=0");

    await endRoute.POST(post(), P(orgId, { callId: id }));
    expect(sent.at(-1)?.body?.action).toBe("terminate");
    expect((await db.waCall.findUniqueOrThrow({ where: { id } })).status).toBe("ended");
  });

  it("asks permission to call, and refuses without the plan feature or with a bad SDP", async () => {
    const sent: Call[] = [];
    meta(sent);
    actAs(agent);
    expect((await permissionRoute.POST(post({ conversationId }), P(orgId))).status).toBe(200);
    expect((sent[0].body!.interactive as { type: string }).type).toBe("call_permission_request");
    expect((await calls.POST(post({ conversationId, sdp: "not sdp" }), P(orgId))).status).toBe(400);

    const sub = await db.subscription.findFirstOrThrow({ where: { organizationId: orgId } });
    await db.plan.update({ where: { id: sub.planId }, data: { features: JSON.stringify(["campaigns"]) } });
    expect((await calls.POST(post({ conversationId, sdp: SDP }), P(orgId))).status).toBe(403);
  });
});
