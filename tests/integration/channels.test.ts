import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as channels from "@/app/api/organizations/[orgId]/channels/route";
import * as channel from "@/app/api/organizations/[orgId]/channels/[chid]/route";
import * as simulate from "@/app/api/organizations/[orgId]/channels/[chid]/simulate/route";
import * as webchat from "@/app/api/webchat/[key]/route";
import * as metaWebhook from "@/app/api/webhooks/meta/route";
import { createHmac } from "node:crypto";
import * as inboundHook from "@/app/api/webhooks/channels/[key]/route";
import * as convList from "@/app/api/organizations/[orgId]/inbox/conversations/route";
import * as messages from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/messages/route";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

let n = 0;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });

async function tenant() {
  const org = await makeOrg(`Chan ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 20 });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "OMNICHANNEL", enabled: true } });
  return { org, owner, agent };
}
async function addEmail(t: Awaited<ReturnType<typeof tenant>>, address = `support${n++}@shop.test`) {
  actAs(t.owner);
  const r = await json(await channels.POST(post({ kind: "email", name: "Support", address }), P(t.org.id)));
  expect(r.status).toBe(201);
  return r.body.channel as { id: string; inboundPath: string; status: string; address: string };
}
const hook = (key: string, body: unknown) => inboundHook.POST(req("/x", { method: "POST", body }), { params: Promise.resolve({ key }) });

describe("channels: email inbox", () => {
  it("owner adds an inbox in demo mode; agents cannot manage", async () => {
    const t = await tenant();
    const c = await addEmail(t);
    expect(c.status).toBe("demo");
    expect(c.inboundPath).toMatch(/^\/api\/webhooks\/channels\/[a-f0-9]{48}$/);
    actAs(t.agent);
    expect((await channels.POST(post({ kind: "email", name: "X", address: "x@y.test" }), P(t.org.id))).status).toBe(403);
    const list = await json(await channels.GET(req("/x"), P(t.org.id)));
    expect((list.body.channels as unknown[]).length).toBe(1);
  });

  it("rejects bad input", async () => {
    const t = await tenant();
    actAs(t.owner);
    expect((await channels.POST(post({ kind: "email", name: "X", address: "nope" }), P(t.org.id))).status).toBe(400);
    expect((await channels.POST(post({ kind: "sms", name: "X" }), P(t.org.id))).status).toBe(400);
    expect((await channels.POST(post({ kind: "email", name: "X", address: "a@b.test", extra: 1 }), P(t.org.id))).status).toBe(400);
  });

  it("cannot go live without an email provider", async () => {
    const t = await tenant();
    const c = await addEmail(t);
    vi.stubEnv("RESEND_API_KEY", "");
    const r = await channel.PATCH(req("/x", { method: "PATCH", body: { status: "active" } }), P(t.org.id, { chid: c.id }));
    expect(r.status).toBe(409);
  });

  it("simulated email creates a contact + conversation; a reply is stored as a demo send", async () => {
    const t = await tenant();
    const c = await addEmail(t);
    actAs(t.owner);
    const s = await json(await simulate.POST(post({ from: "Buyer@Example.com", name: "Buyer", subject: "Pricing", body: "What is the price?" }), P(t.org.id, { chid: c.id })));
    expect(s.status).toBe(201);
    const convId = s.body.conversationId as string;
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: convId }, include: { contact: { include: { identities: true } } } });
    expect(conv.channel).toBe("email");
    expect(conv.whatsappAccountId).toBeNull();
    expect(conv.subject).toBe("Pricing");
    expect(conv.contact.email).toBe("buyer@example.com");
    expect(conv.contact.identities[0]).toMatchObject({ kind: "email", value: "buyer@example.com" });

    const list = await json(await convList.GET(req("/x"), P(t.org.id)));
    const item = (list.body.items as { id: string; channel: string; windowOpen: boolean; account: { displayName: string } }[]).find((i) => i.id === convId)!;
    expect(item).toMatchObject({ channel: "email", windowOpen: true });
    expect(item.account.displayName).toBe("Support");

    const sent = await json(await messages.POST(post({ type: "text", body: "It is Rs 500." }), P(t.org.id, { cid: convId })));
    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ status: "sent", isDemo: true });
    // Non-text replies are refused on email.
    const bad = await messages.POST(post({ type: "image", link: "https://example.com/a.png" }), P(t.org.id, { cid: convId }));
    expect(bad.status).toBe(400);
  });

  it("same sender keeps one contact and one conversation", async () => {
    const t = await tenant();
    const c = await addEmail(t);
    actAs(t.owner);
    for (let i = 0; i < 2; i++) await simulate.POST(post({ from: "same@example.com", body: `msg ${i}` }), P(t.org.id, { chid: c.id }));
    expect(await db.conversation.count({ where: { organizationId: t.org.id } })).toBe(1);
    expect(await db.contact.count({ where: { organizationId: t.org.id } })).toBe(1);
  });

  it("inbound webhook: secret key required, dedupes, validates", async () => {
    const t = await tenant();
    const c = await addEmail(t);
    const key = c.inboundPath.split("/").pop()!;
    expect((await hook("0".repeat(48), { from: "a@b.test", text: "hi" })).status).toBe(404);
    expect((await hook(key, { from: "not-an-email", text: "hi" })).status).toBe(400);
    expect((await hook(key, { from: "a@b.test", text: "hi", unknown: 1 })).status).toBe(400);
    const ok1 = await json(await hook(key, { from: "a@b.test", fromName: "A", subject: "Hello", text: "hi there", messageId: "<abc@mail>" }));
    expect(ok1.body).toMatchObject({ received: 1 });
    const dup = await json(await hook(key, { from: "a@b.test", text: "hi there", messageId: "<abc@mail>" }));
    expect(dup.body).toMatchObject({ received: 0, duplicate: 1 });
    expect(await db.message.count({ where: { organizationId: t.org.id, direction: "inbound" } })).toBe(1);
  });

  it("a disabled inbox rejects inbound mail; keys are per inbox (no cross-tenant delivery)", async () => {
    const a = await tenant();
    const b = await tenant();
    const ca = await addEmail(a);
    const cb = await addEmail(b);
    actAs(a.owner);
    await channel.PATCH(req("/x", { method: "PATCH", body: { status: "disabled" } }), P(a.org.id, { chid: ca.id }));
    expect((await hook(ca.inboundPath.split("/").pop()!, { from: "x@y.test", text: "hi" })).status).toBe(404);
    await hook(cb.inboundPath.split("/").pop()!, { from: "x@y.test", text: "hi" });
    expect(await db.message.count({ where: { organizationId: a.org.id } })).toBe(0);
    expect(await db.message.count({ where: { organizationId: b.org.id } })).toBe(1);
    // Org A cannot touch org B's inbox.
    expect((await channel.DELETE(req("/x", { method: "DELETE" }), P(a.org.id, { chid: cb.id }))).status).toBe(404);
  });

  it("live inbox sends through the provider and records failures", async () => {
    const t = await tenant();
    const c = await addEmail(t);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "MECGURA <no-reply@mecgura.tech>");
    actAs(t.owner);
    expect((await channel.PATCH(req("/x", { method: "PATCH", body: { status: "active" } }), P(t.org.id, { chid: c.id }))).status).toBe(200);
    const key = c.inboundPath.split("/").pop()!;
    await hook(key, { from: "cust@example.com", subject: "Order", text: "Where is it?", messageId: "<m1@mail>" });
    const conv = await db.conversation.findFirstOrThrow({ where: { organizationId: t.org.id } });
    const calls: { headers?: Record<string, string>; body: Record<string, unknown> }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      calls.push({ body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: "re_123" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const sent = await json(await messages.POST(post({ type: "text", body: "On its way." }), P(t.org.id, { cid: conv.id })));
    expect(sent.body.message).toMatchObject({ status: "sent", isDemo: false });
    expect(calls[0].body).toMatchObject({ to: ["cust@example.com"], subject: "Re: Order" });
    expect((calls[0].body.headers as Record<string, string>)["In-Reply-To"]).toBe("<m1@mail>");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 }));
    const failed = await json(await messages.POST(post({ type: "text", body: "Again" }), P(t.org.id, { cid: conv.id })));
    expect(failed.body.message).toMatchObject({ status: "failed", error: "domain not verified" });
  });
});

describe("channels: website chat", () => {
  const VID = "a".repeat(24) + "b1c2d3";
  const wcPost = (key: string, body: unknown, ip = "198.51.100.7") => webchat.POST(req("/x", { method: "POST", body, headers: { "x-forwarded-for": ip } }), { params: Promise.resolve({ key }) });
  const wcGet = (key: string, qs = "") => webchat.GET(req(`/x${qs}`), { params: Promise.resolve({ key }) });

  async function addChat(t: Awaited<ReturnType<typeof tenant>>) {
    actAs(t.owner);
    const r = await json(await channels.POST(post({ kind: "webchat", name: "Website chat" }), P(t.org.id)));
    expect(r.status).toBe(201);
    return r.body.channel as { id: string; publicKey: string; status: string };
  }

  it("is live immediately and serves public widget settings with CORS", async () => {
    const t = await tenant();
    const c = await addChat(t);
    expect(c.status).toBe("active");
    const res = await wcGet(c.publicKey);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as { config: { name: string; color: string } };
    expect(body.config).toMatchObject({ name: "Website chat", color: "#0f766e" });
    expect((await wcGet("0".repeat(48))).status).toBe(404);
  });

  it("visitor message reaches the inbox and the team's reply comes back; notes never do", async () => {
    const t = await tenant();
    const c = await addChat(t);
    expect((await wcPost(c.publicKey, { visitorId: VID, text: "Hello, do you deliver?" })).status).toBe(201);
    const conv = await db.conversation.findFirstOrThrow({ where: { organizationId: t.org.id }, include: { contact: true } });
    expect(conv.channel).toBe("webchat");
    expect(conv.contact.name).toMatch(/^Website visitor /);
    actAs(t.owner);
    await messages.POST(post({ type: "text", body: "Yes, across the city." }), P(t.org.id, { cid: conv.id }));
    await db.message.create({ data: { organizationId: t.org.id, conversationId: conv.id, direction: "internal", type: "note", body: "secret note", status: "received" } });
    const got = (await (await wcGet(c.publicKey, `?visitorId=${VID}`)).json()) as { messages: { id: string; text: string }[] };
    expect(got.messages.map((m) => m.text)).toEqual(["Yes, across the city."]);
    // Another visitor sees nothing.
    const other = (await (await wcGet(c.publicKey, `?visitorId=${"z".repeat(30)}`)).json()) as { messages: unknown[] };
    expect(other.messages).toEqual([]);
  });

  it("validates input and refuses disabled inboxes", async () => {
    const t = await tenant();
    const c = await addChat(t);
    expect((await wcPost(c.publicKey, { visitorId: "short", text: "hi" })).status).toBe(400);
    expect((await wcPost(c.publicKey, { visitorId: VID, text: "" })).status).toBe(400);
    expect((await wcPost(c.publicKey, { visitorId: VID, text: "x".repeat(2001) })).status).toBe(400);
    expect((await wcPost(c.publicKey, { visitorId: VID, text: "hi", extra: 1 })).status).toBe(400);
    actAs(t.owner);
    await channel.PATCH(req("/x", { method: "PATCH", body: { status: "disabled" } }), P(t.org.id, { chid: c.id }));
    expect((await wcPost(c.publicKey, { visitorId: VID, text: "hi" })).status).toBe(404);
  });

  it("caps brand-new visitors per IP", async () => {
    const t = await tenant();
    const c = await addChat(t);
    const ip = `203.0.113.${100 + n++}`;
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await wcPost(c.publicKey, { visitorId: `v${i}`.padEnd(30, "q"), text: "hi" }, ip)).status);
    expect(codes.slice(0, 10).every((x) => x === 201), codes.join(",")).toBe(true);
    expect(codes[10]).toBe(429);
  });
});


describe("channels: Messenger and Instagram", () => {
  const SECRET = "test-app-secret-test-app-secret-1234";
  const TOKEN = `EAAG${"x".repeat(60)}`;
  const pid = () => `77${String(Date.now()).slice(-8)}${n++}`;
  const signed = (obj: "page" | "instagram", entry: unknown) => {
    const raw = JSON.stringify({ object: obj, entry: [entry] });
    return new Request("http://localhost:3000/api/webhooks/meta", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}` }, body: raw });
  };
  function graphOk(calls: { url: URL; body?: Record<string, unknown> }[] = []) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const id = url.pathname.split("/").filter(Boolean).at(-1)!;
      if (url.pathname.endsWith("/messages")) return new Response(JSON.stringify({ message_id: "m_out_1" }), { status: 200 });
      return new Response(JSON.stringify({ id, name: "Shop Page", username: "shop_ig" }), { status: 200 });
    });
  }
  async function connect(t: Awaited<ReturnType<typeof tenant>>, kind: "messenger" | "instagram", address = pid()) {
    actAs(t.owner);
    const r = await json(await channels.POST(post({ kind, name: "Social", address, accessToken: TOKEN }), P(t.org.id)));
    return { r, address };
  }

  it("verifies the token with Meta, stores it encrypted, never returns it", async () => {
    vi.stubEnv("META_APP_SECRET", SECRET);
    graphOk();
    const t = await tenant();
    const { r, address } = await connect(t, "messenger");
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain(TOKEN);
    const row = await db.channelAccount.findFirstOrThrow({ where: { address } });
    expect(row.encryptedToken).not.toBe("");
    expect(row.encryptedToken).not.toContain(TOKEN);
    expect(row.status).toBe("active");
    // The same account can't be claimed by another workspace.
    const other = await tenant();
    expect((await connect(other, "messenger", address)).r.status).toBe(409);
  });

  it("rejects a token Meta refuses and malformed input", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ error: { message: "Invalid OAuth access token", code: 190 } }), { status: 400 }));
    const t = await tenant();
    expect((await connect(t, "instagram")).r.status).toBe(400);
    actAs(t.owner);
    expect((await channels.POST(post({ kind: "messenger", name: "X", address: "abc", accessToken: TOKEN }), P(t.org.id))).status).toBe(400);
    expect((await channels.POST(post({ kind: "messenger", name: "X", address: "12345678" }), P(t.org.id))).status).toBe(400);
  });

  it("inbound DM creates a chat; echoes and duplicates are ignored; reply goes out through Graph", async () => {
    vi.stubEnv("META_APP_SECRET", SECRET);
    const calls: { url: URL; body?: Record<string, unknown> }[] = [];
    graphOk(calls);
    const t = await tenant();
    const { address } = await connect(t, "messenger");
    const dm = { id: address, messaging: [{ sender: { id: "psid-1" }, timestamp: Date.now(), message: { mid: "mid.1", text: "Is this in stock?" } }] };
    expect((await json(await metaWebhook.POST(signed("page", dm)))).body).toEqual({ received: 1, duplicates: 0 });
    expect((await json(await metaWebhook.POST(signed("page", dm)))).body).toEqual({ received: 0, duplicates: 1 });
    const echo = { id: address, messaging: [{ sender: { id: address }, message: { mid: "mid.2", text: "our own", is_echo: true } }] };
    expect((await json(await metaWebhook.POST(signed("page", echo)))).body).toEqual({ received: 0, duplicates: 0 });
    // Wrong signature is refused.
    const bad = signed("page", dm);
    expect((await metaWebhook.POST(new Request(bad.url, { method: "POST", headers: { "x-hub-signature-256": "sha256=00" }, body: await bad.text() }))).status).toBe(401);

    const conv = await db.conversation.findFirstOrThrow({ where: { organizationId: t.org.id } });
    expect(conv.channel).toBe("messenger");
    actAs(t.owner);
    const sent = await json(await messages.POST(post({ type: "text", body: "Yes!" }), P(t.org.id, { cid: conv.id })));
    expect(sent.body.message).toMatchObject({ status: "sent" });
    const out = calls.find((c) => c.url.pathname.endsWith("/messages"))!;
    expect(out.body).toMatchObject({ recipient: { id: "psid-1" }, messaging_type: "RESPONSE", message: { text: "Yes!" } });
  });

  it("refuses replies after the 24-hour window; instagram events only reach instagram inboxes", async () => {
    vi.stubEnv("META_APP_SECRET", SECRET);
    graphOk();
    const t = await tenant();
    const { address } = await connect(t, "instagram");
    // A page event for the same id must not reach an instagram inbox.
    const dm = { id: address, messaging: [{ sender: { id: "igsid-1" }, message: { mid: "mid.ig1", text: "hi" } }] };
    expect((await json(await metaWebhook.POST(signed("page", dm)))).body).toEqual({ received: 0, duplicates: 0 });
    expect((await json(await metaWebhook.POST(signed("instagram", dm)))).body).toEqual({ received: 1, duplicates: 0 });
    const conv = await db.conversation.findFirstOrThrow({ where: { organizationId: t.org.id } });
    await db.conversation.update({ where: { id: conv.id }, data: { lastInboundAt: new Date(Date.now() - 25 * 3600_000) } });
    actAs(t.owner);
    const res = await messages.POST(post({ type: "text", body: "late" }), P(t.org.id, { cid: conv.id }));
    expect(res.status).toBe(409);
  });
});

describe("service gating", () => {
  it("a workspace without the omnichannel service can't use channels, and public endpoints go quiet", async () => {
    const t = await tenant();
    const c = await addEmail(t);
    const widget = (await json(await channels.POST(post({ kind: "webchat", name: "Chat" }), P(t.org.id)))).body.channel as { publicKey: string };
    await db.organizationService.update({ where: { organizationId_service: { organizationId: t.org.id, service: "OMNICHANNEL" } }, data: { enabled: false } });
    actAs(t.owner);
    expect((await channels.GET(req("/x"), P(t.org.id))).status).toBe(403);
    expect((await channels.POST(post({ kind: "email", name: "X", address: "x@y.test" }), P(t.org.id))).status).toBe(403);
    expect((await hook(c.inboundPath.split("/").pop()!, { from: "a@b.test", text: "hi" })).status).toBe(404);
    expect((await webchat.GET(req("/x"), { params: Promise.resolve({ key: widget.publicKey }) })).status).toBe(404);
    expect(await db.message.count({ where: { organizationId: t.org.id } })).toBe(0);
  });
});
