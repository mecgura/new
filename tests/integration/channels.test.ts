import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as channels from "@/app/api/organizations/[orgId]/channels/route";
import * as channel from "@/app/api/organizations/[orgId]/channels/[chid]/route";
import * as simulate from "@/app/api/organizations/[orgId]/channels/[chid]/simulate/route";
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
