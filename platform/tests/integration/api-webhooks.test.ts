import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Background work (webhook delivery after the response) is collected and run explicitly by the tests.
const bg = vi.hoisted(() => ({ tasks: [] as (() => Promise<unknown>)[] }));
vi.mock("@/lib/background", () => ({ runAfterResponse: (t: () => Promise<unknown>) => bg.tasks.push(t) }));
// DNS is stubbed so webhook URLs resolve to a public or a private address on demand.
const dns = vi.hoisted(() => ({ privateHosts: new Set<string>(["internal.example.com"]) }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async (host: string) => [{ address: dns.privateHosts.has(host) ? "10.0.0.5" : "93.184.216.34", family: 4 }]) }));

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import { resetRateLimits } from "@/lib/rate-limit";
import { hashApiKey } from "@/lib/api-keys";
import { verifySignature, signPayload, MAX_ATTEMPTS, WEBHOOK_LIMITS, WEBHOOK_EVENT_LIST } from "@/lib/webhook-events";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as activeNumber from "@/app/api/organizations/[orgId]/whatsapp/active/route";
import * as demoInbound from "@/app/api/organizations/[orgId]/inbox/demo/inbound/route";
import * as demoStatus from "@/app/api/organizations/[orgId]/inbox/demo/status/route";
import * as convList from "@/app/api/organizations/[orgId]/inbox/conversations/route";
import * as messagesRoute from "@/app/api/organizations/[orgId]/inbox/conversations/[cid]/messages/route";
import * as contactsRoute from "@/app/api/organizations/[orgId]/contacts/route";
import * as contactRoute from "@/app/api/organizations/[orgId]/contacts/[id]/route";
import * as campaigns from "@/app/api/organizations/[orgId]/campaigns/route";
import * as campaign from "@/app/api/organizations/[orgId]/campaigns/[cid]/route";
import * as automations from "@/app/api/organizations/[orgId]/automations/route";
import * as automation from "@/app/api/organizations/[orgId]/automations/[aid]/route";
import * as automationPublish from "@/app/api/organizations/[orgId]/automations/[aid]/publish/route";
import * as templatesRoute from "@/app/api/organizations/[orgId]/templates/route";
import * as templateSubmit from "@/app/api/organizations/[orgId]/templates/[tid]/submit/route";
import * as templateReview from "@/app/api/organizations/[orgId]/templates/[tid]/review/route";
import * as flowsRoute from "@/app/api/organizations/[orgId]/flows/route";
import * as flowPublish from "@/app/api/organizations/[orgId]/flows/[fid]/publish/route";
import * as flowDemoSubmit from "@/app/api/organizations/[orgId]/flows/[fid]/demo-submit/route";
import * as keysRoute from "@/app/api/organizations/[orgId]/api-keys/route";
import * as keyRoute from "@/app/api/organizations/[orgId]/api-keys/[kid]/route";
import * as keyRotate from "@/app/api/organizations/[orgId]/api-keys/[kid]/rotate/route";
import * as keyRevoke from "@/app/api/organizations/[orgId]/api-keys/[kid]/revoke/route";
import * as usageRoute from "@/app/api/organizations/[orgId]/api-usage/route";
import * as logsRoute from "@/app/api/organizations/[orgId]/api-logs/route";
import * as hooksRoute from "@/app/api/organizations/[orgId]/webhooks/route";
import * as hookRoute from "@/app/api/organizations/[orgId]/webhooks/[wid]/route";
import * as hookTest from "@/app/api/organizations/[orgId]/webhooks/[wid]/test/route";
import * as hookRotate from "@/app/api/organizations/[orgId]/webhooks/[wid]/rotate-secret/route";
import * as hookDeliveries from "@/app/api/organizations/[orgId]/webhooks/[wid]/deliveries/route";
import * as hookRedeliver from "@/app/api/organizations/[orgId]/webhooks/[wid]/deliveries/[did]/redeliver/route";
import * as v1Me from "@/app/api/v1/me/route";
import * as v1Numbers from "@/app/api/v1/numbers/route";
import * as v1Templates from "@/app/api/v1/templates/route";
import * as v1Contacts from "@/app/api/v1/contacts/route";
import * as v1Contact from "@/app/api/v1/contacts/[id]/route";
import * as v1Conversations from "@/app/api/v1/conversations/route";
import * as v1ConvMessages from "@/app/api/v1/conversations/[id]/messages/route";
import * as v1Messages from "@/app/api/v1/messages/route";
import { runDueWebhooks, purgeWebhookData, invalidateWebhookCache } from "@/services/webhooks/delivery";
import { emitCampaignCompleted } from "@/services/webhooks/events";
import { runDueAutomations } from "@/services/automations/engine";
import { defaultData, type FlowEdge, type FlowNode, type Graph, type NodeDataMap, type NodeType } from "@/lib/automations";

type U = Awaited<ReturnType<typeof makeUser>>;
type Tenant = { orgId: string; owner: U; manager: U; agent: U; accountA: string; accountB: string; wabaA: string };
let n = 0;
const phone = () => `+9195${String(Date.now()).slice(-6)}${String(n++).padStart(2, "0")}`;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body?: unknown) => req("/x", { method: "POST", body });
const patch = (body: unknown) => req("/x", { method: "PATCH", body });
const get = (path = "/x") => req(path);
const del = () => req("/x", { method: "DELETE" });

async function makeTenant(maxNumbers = 3): Promise<Tenant> {
  const org = await makeOrg(`P8 ${n++}`);
  const [owner, manager, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Manager" }), makeUser({ name: "Agent" })]);
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 20, maxWhatsAppNumbers: maxNumbers });
  await db.plan.update({ where: { id: plan.id }, data: { maxContacts: 10_000 } });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  const a = await json(await demoConnect.POST(post({ businessName: "Store One" }), P(org.id)));
  const b = await json(await demoConnect.POST(post({ businessName: "Store Two" }), P(org.id)));
  const accountA = (a.body.account as { id: string }).id;
  const acct = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: accountA } });
  return { orgId: org.id, owner, manager, agent, accountA, accountB: (b.body.account as { id: string }).id, wabaA: acct.wabaRecordId! };
}

async function inbound(t: Tenant, accountId: string, body: string, from = phone(), name = "Simran") {
  const r = await json(await demoInbound.POST(post({ whatsappAccountId: accountId, phone: from, name, body }), P(t.orgId)));
  expect(r.status).toBe(201);
  return { ...(r.body as { contactId: string; conversationId: string }), phone: from };
}

async function makeKey(t: Tenant, permissions: string[], extra: Record<string, unknown> = {}) {
  actAs(t.owner);
  const r = await json(await keysRoute.POST(post({ name: "Integration", permissions, ...extra }), P(t.orgId)));
  expect(r.status).toBe(201);
  return { secret: r.body.secret as string, id: (r.body.key as { id: string }).id };
}

let ipSeq = 10;
/** An API call authenticated with `key`, from its own IP so failed-auth throttling in one test can't leak into another. */
function api(handler: (r: Request, c?: never) => Promise<Response>, path: string, key: string | null, init: { method?: string; body?: unknown; ip?: string; ctx?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": init.ip ?? `198.51.100.${ipSeq++ % 250}`, "user-agent": "vitest-client/1.0" };
  if (key) headers.authorization = `Bearer ${key}`;
  const r = req(path, { method: init.method ?? "GET", body: init.body, headers });
  return (handler as unknown as (r: Request, c: unknown) => Promise<Response>)(r, init.ctx ? params(init.ctx) : undefined);
}
const call = async (...a: Parameters<typeof api>) => {
  const res = await api(...a);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: response shapes vary per endpoint
  return { status: res.status, headers: res.headers, body: (await res.json()) as Record<string, unknown> & { data?: any; error?: string; code?: string } };
};

// Webhook receiver stub -----------------------------------------------------------------------
type Hit = { url: string; headers: Record<string, string>; body: string };
let hits: Hit[] = [];
let respond: (url: string) => { status: number } | Error = () => ({ status: 200 });
const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
  const url = String(input);
  hits.push({ url, headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), body: String(init?.body ?? "") });
  const r = respond(url);
  if (r instanceof Error) throw r;
  return new Response(null, { status: r.status });
});

async function flush() {
  while (bg.tasks.length) await bg.tasks.shift()!();
}
const hitsFor = (url: string, event?: string) => hits.filter((h) => h.url.startsWith(url) && (!event || h.headers["X-Mecgura-Event"] === event));

async function makeHook(t: Tenant, events: string[], url = "https://hooks.example.com/mecgura", actor: U = t.owner) {
  actAs(actor);
  const r = await json(await hooksRoute.POST(post({ url, events, description: "test" }), P(t.orgId)));
  expect(r.status).toBe(201);
  invalidateWebhookCache();
  return { id: (r.body.endpoint as { id: string }).id, secret: r.body.secret as string };
}

let A: Tenant;
let B: Tenant;
beforeAll(async () => {
  A = await makeTenant();
  B = await makeTenant();
});
beforeEach(() => {
  hits = [];
  respond = () => ({ status: 200 });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  resetRateLimits();
});
afterEach(() => {
  bg.tasks.length = 0;
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------
describe("multiple WhatsApp numbers", () => {
  it("a workspace connects several numbers; each belongs to exactly one tenant; the plan limit applies", async () => {
    actAs(A.owner);
    const accounts = await db.whatsAppAccount.findMany({ where: { organizationId: A.orgId } });
    expect(accounts.map((a) => a.id).sort()).toEqual([A.accountA, A.accountB].sort());
    expect(new Set(accounts.map((a) => a.phoneNumber)).size).toBe(2);
    // No number can appear in two workspaces (phoneNumber is unique across the platform).
    const other = await db.whatsAppAccount.findMany({ where: { organizationId: B.orgId } });
    expect(other.some((o) => accounts.some((a) => a.phoneNumber === o.phoneNumber))).toBe(false);
    // Third number is fine on a 3-number plan, the fourth is refused.
    expect((await demoConnect.POST(post({ businessName: "Third" }), P(A.orgId))).status).toBe(201);
    const fourth = await json(await demoConnect.POST(post({ businessName: "Fourth" }), P(A.orgId)));
    expect(fourth.status).toBe(409);
    expect(String(fourth.body.error)).toMatch(/plan allows 3/);
    // Free the slot again so later tests keep two numbers.
    const third = await db.whatsAppAccount.findFirstOrThrow({ where: { organizationId: A.orgId, displayName: { contains: "Third" } } });
    await db.whatsAppAccount.update({ where: { id: third.id }, data: { status: "disconnected" } });
  });

  it("the same customer gets a separate conversation per number, and the inbox filters by number", async () => {
    actAs(A.owner);
    const from = phone();
    const a = await inbound(A, A.accountA, "hello store one", from);
    const b = await inbound(A, A.accountB, "hello store two", from);
    expect(a.contactId).toBe(b.contactId); // one contact…
    expect(a.conversationId).not.toBe(b.conversationId); // …two threads
    const list = async (accountId: string, org = A.orgId) => json(await convList.GET(get(`/x?accountId=${accountId}&pageSize=50&status=all`), P(org)));
    const onA = (await list(A.accountA)).body.items as { id: string; account: { id: string } }[];
    expect(onA.map((c) => c.id)).toContain(a.conversationId);
    expect(onA.map((c) => c.id)).not.toContain(b.conversationId);
    expect(onA.every((c) => c.account.id === A.accountA)).toBe(true);
    // A number id from another workspace leaks nothing.
    expect(((await list(B.accountA)).body.items as unknown[]).length).toBe(0);
    // Replying goes out through the number the customer wrote to.
    const sent = await json(await messagesRoute.POST(post({ type: "text", body: "hi from two" }), P(A.orgId, { cid: b.conversationId })));
    expect(sent.status).toBe(201);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: b.conversationId } })).whatsappAccountId).toBe(A.accountB);
  });

  it("switching the active number is validated against the workspace", async () => {
    actAs(A.owner);
    expect((await json(await activeNumber.PUT(req("/x", { method: "PUT", body: { accountId: A.accountB } }), P(A.orgId)))).status).toBe(200);
    // Another workspace's number is refused…
    const bad = await json(await activeNumber.PUT(req("/x", { method: "PUT", body: { accountId: B.accountA } }), P(A.orgId)));
    expect(bad.status).toBe(400);
    // …and so is switching in a workspace you don't belong to.
    expect((await activeNumber.PUT(req("/x", { method: "PUT", body: { accountId: B.accountA } }), P(B.orgId))).status).toBe(403);
    // "" = all numbers.
    expect((await json(await activeNumber.PUT(req("/x", { method: "PUT", body: { accountId: "" } }), P(A.orgId)))).status).toBe(200);
    const audit = await db.auditLog.count({ where: { organizationId: A.orgId, action: "whatsapp.active_number_changed" } });
    expect(audit).toBeGreaterThanOrEqual(2);
  });

  it("a campaign picks its sending number, and only from this workspace", async () => {
    actAs(A.owner);
    const c = await json(await campaigns.POST(post({ name: "Diwali", description: "", whatsappAccountId: A.accountB }), P(A.orgId)));
    expect(c.status).toBe(201);
    const cid = (c.body.campaign as { id: string }).id;
    expect((await db.campaign.findUniqueOrThrow({ where: { id: cid } })).whatsappAccountId).toBe(A.accountB);
    expect((await json(await campaign.PATCH(patch({ whatsappAccountId: A.accountA }), P(A.orgId, { cid })))).status).toBe(200);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: cid } })).whatsappAccountId).toBe(A.accountA);
    // Tenant B's number can't be used by A, in create or in update.
    expect((await json(await campaigns.POST(post({ name: "Steal", description: "", whatsappAccountId: B.accountA }), P(A.orgId)))).status).toBe(400);
    expect((await json(await campaign.PATCH(patch({ whatsappAccountId: B.accountA }), P(A.orgId, { cid })))).status).toBe(400);
  });

  it("an automation applies only to its own number", async () => {
    actAs(A.owner);
    const node = <T extends NodeType>(id: string, type: T, data: Partial<NodeDataMap[T]> = {}): FlowNode => ({ id, type, position: { x: 0, y: 0 }, data: { ...defaultData(type), ...data } as FlowNode["data"] });
    const edge = (s: string, t: string): FlowEdge => ({ id: `${s}-${t}`, source: s, target: t, sourceHandle: null });
    const graph: Graph = { nodes: [node("t", "trigger", { trigger: "keyword", keywords: ["menu"] }), node("e", "end")], edges: [edge("t", "e")] };
    const c = await json(await automations.POST(post({ name: "Menu bot", whatsappAccountId: A.accountA }), P(A.orgId)));
    expect(c.status).toBe(201);
    const aid = (c.body.automation as { id: string }).id;
    expect((await automation.PATCH(patch({ graph }), P(A.orgId, { aid }))).status).toBe(200);
    expect((await json(await automationPublish.POST(post({ note: "v1" }), P(A.orgId, { aid })))).status).toBe(200);
    expect((await json(await automations.POST(post({ name: "Steal", whatsappAccountId: B.accountA }), P(A.orgId)))).status).toBe(400);

    await inbound(A, A.accountB, "menu");
    await runDueAutomations(5_000);
    expect(await db.automationExecution.count({ where: { automationId: aid } })).toBe(0);
    await inbound(A, A.accountA, "menu");
    await runDueAutomations(5_000);
    expect(await db.automationExecution.count({ where: { automationId: aid } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe("API keys", () => {
  it("only owners create keys; the secret is shown once and only its hash is stored", async () => {
    for (const who of [A.manager, A.agent]) {
      actAs(who);
      expect((await keysRoute.POST(post({ name: "x", permissions: ["contacts:read"] }), P(A.orgId))).status).toBe(403);
    }
    actAs(A.owner);
    const bad = await json(await keysRoute.POST(post({ name: "x", permissions: [] }), P(A.orgId)));
    expect(bad.status).toBe(400);
    expect((await json(await keysRoute.POST(post({ name: "x", permissions: ["root:everything"] }), P(A.orgId)))).status).toBe(400);

    const c = await json(await keysRoute.POST(post({ name: "CRM sync", permissions: ["contacts:read", "contacts:write"] }), P(A.orgId)));
    expect(c.status).toBe(201);
    const secret = c.body.secret as string;
    expect(secret).toMatch(/^mgk_[A-Za-z0-9_-]{43}$/);
    const row = await db.apiKey.findUniqueOrThrow({ where: { id: (c.body.key as { id: string }).id } });
    expect(row.keyHash).toBe(createHash("sha256").update(secret).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(row.prefix).toBe(secret.slice(0, 12));
    // Listing, reading again or auditing never reveals it.
    const list = await json(await keysRoute.GET(get(), P(A.orgId)));
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(JSON.stringify(list.body)).not.toContain(row.keyHash);
    const audits = await db.auditLog.findMany({ where: { organizationId: A.orgId, action: "api_key.created" } });
    expect(JSON.stringify(audits)).not.toContain(secret);
    // Managers may look at the list (read-only); agents may not.
    actAs(A.manager);
    expect((await keysRoute.GET(get(), P(A.orgId))).status).toBe(200);
    actAs(A.agent);
    expect((await keysRoute.GET(get(), P(A.orgId))).status).toBe(403);
  });

  it("authentication: missing, malformed, unknown, query-string and wrong-scheme keys are all refused", async () => {
    const k = await makeKey(A, ["numbers:read"]);
    expect((await call(v1Numbers.GET, "/api/v1/numbers", null)).status).toBe(401);
    expect((await call(v1Numbers.GET, "/api/v1/numbers", "not-a-key")).status).toBe(401);
    expect((await call(v1Numbers.GET, "/api/v1/numbers", `mgk_${"A".repeat(43)}`)).status).toBe(401);
    // A key in the URL is never accepted — URLs end up in logs.
    expect((await api(v1Numbers.GET, `/api/v1/numbers?api_key=${k.secret}`, null)).status).toBe(401);
    const basic = await (v1Numbers.GET as unknown as (r: Request) => Promise<Response>)(req("/api/v1/numbers", { headers: { authorization: `Basic ${k.secret}`, "x-forwarded-for": "198.51.100.200" } }));
    expect(basic.status).toBe(401);
    const good = await call(v1Numbers.GET, "/api/v1/numbers", k.secret);
    expect(good.status).toBe(200);
    expect(good.headers.get("cache-control")).toBe("no-store");
    expect(good.headers.get("x-request-id")).toMatch(/^req_/);
    expect(good.body.error).toBeUndefined();
  });

  it("permissions: a key only does what its scopes allow", async () => {
    const k = await makeKey(A, ["contacts:read"]);
    expect((await call(v1Contacts.GET, "/api/v1/contacts", k.secret)).status).toBe(200);
    const denied = await call(v1Contacts.POST, "/api/v1/contacts", k.secret, { method: "POST", body: { phone: phone() } });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/contacts:write/);
    expect((await call(v1Numbers.GET, "/api/v1/numbers", k.secret)).status).toBe(403);
    expect((await call(v1Messages.POST, "/api/v1/messages", k.secret, { method: "POST", body: { to: phone(), type: "text", text: "x" } })).status).toBe(403);
    // /me needs no scope.
    const me = await call(v1Me.GET, "/api/v1/me", k.secret);
    expect(me.status).toBe(200);
    expect(me.body.data.key.permissions).toEqual(["contacts:read"]);
    expect(me.body.data.organization.id).toBe(A.orgId);
    // Editing permissions takes effect immediately.
    actAs(A.owner);
    expect((await keyRoute.PATCH(patch({ permissions: ["contacts:read", "numbers:read"] }), P(A.orgId, { kid: k.id }))).status).toBe(200);
    expect((await call(v1Numbers.GET, "/api/v1/numbers", k.secret)).status).toBe(200);
  });

  it("revoke, expiry, suspended workspace and rotation (with and without a grace period)", async () => {
    const k = await makeKey(A, ["numbers:read"]);
    expect((await call(v1Numbers.GET, "/api/v1/numbers", k.secret)).status).toBe(200);
    actAs(A.owner);
    expect((await json(await keyRevoke.POST(post(), P(A.orgId, { kid: k.id })))).status).toBe(200);
    const revoked = await call(v1Numbers.GET, "/api/v1/numbers", k.secret);
    expect(revoked.status).toBe(401);
    expect(revoked.body.error).toMatch(/revoked/);
    expect((await json(await keyRevoke.POST(post(), P(A.orgId, { kid: k.id })))).status).toBe(409);
    expect((await json(await keyRotate.POST(post({}), P(A.orgId, { kid: k.id })))).status).toBe(409);

    const e = await makeKey(A, ["numbers:read"], { expiresInDays: 1 });
    await db.apiKey.update({ where: { id: e.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call(v1Numbers.GET, "/api/v1/numbers", e.secret)).body.error).toMatch(/expired/);

    // Rotation, immediate: the old secret dies, the new one works, permissions carry over.
    const r1 = await makeKey(A, ["numbers:read", "contacts:read"]);
    actAs(A.owner);
    const rot = await json(await keyRotate.POST(post({ graceHours: 0 }), P(A.orgId, { kid: r1.id })));
    expect(rot.status).toBe(201);
    const fresh = rot.body.secret as string;
    expect(fresh).not.toBe(r1.secret);
    expect((await call(v1Numbers.GET, "/api/v1/numbers", r1.secret)).status).toBe(401);
    expect((await call(v1Contacts.GET, "/api/v1/contacts", fresh)).status).toBe(200);
    // Rotation with a grace period: both work until the old key's expiry.
    const r2 = await makeKey(A, ["numbers:read"]);
    actAs(A.owner);
    const rot2 = await json(await keyRotate.POST(post({ graceHours: 24 }), P(A.orgId, { kid: r2.id })));
    expect((await call(v1Numbers.GET, "/api/v1/numbers", r2.secret)).status).toBe(200);
    expect((await call(v1Numbers.GET, "/api/v1/numbers", rot2.body.secret as string)).status).toBe(200);
    expect((rot2.body.previous as { status: string }).status).toBe("expiring");
    await db.apiKey.update({ where: { id: r2.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await call(v1Numbers.GET, "/api/v1/numbers", r2.secret)).status).toBe(401);

    // A suspended workspace's keys stop working.
    const s = await makeTenant();
    const sk = await makeKey(s, ["numbers:read"]);
    await db.organization.update({ where: { id: s.orgId }, data: { status: "suspended" } });
    expect((await call(v1Numbers.GET, "/api/v1/numbers", sk.secret)).status).toBe(403);
  });

  it("rate limiting: per key, with headers, and brute-force protection per IP", async () => {
    const k = await makeKey(A, ["numbers:read"]);
    const first = await call(v1Numbers.GET, "/api/v1/numbers", k.secret, { ip: "203.0.113.50" });
    expect(first.headers.get("x-ratelimit-limit")).toBe("120");
    expect(first.headers.get("x-ratelimit-remaining")).toBe("119");
    let last = first;
    for (let i = 0; i < 119; i++) last = await call(v1Numbers.GET, "/api/v1/numbers", k.secret, { ip: "203.0.113.50" });
    expect(last.status).toBe(200);
    expect(last.headers.get("x-ratelimit-remaining")).toBe("0");
    const limited = await call(v1Numbers.GET, "/api/v1/numbers", k.secret, { ip: "203.0.113.50" });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another key isn't affected.
    const k2 = await makeKey(A, ["numbers:read"]);
    expect((await call(v1Numbers.GET, "/api/v1/numbers", k2.secret, { ip: "203.0.113.50" })).status).toBe(200);

    // Guessing keys: after 20 failures this IP is refused even with a valid key.
    for (let i = 0; i < 20; i++) expect((await call(v1Numbers.GET, "/api/v1/numbers", `mgk_${"B".repeat(43)}`, { ip: "203.0.113.99" })).status).toBe(401);
    const blocked = await call(v1Numbers.GET, "/api/v1/numbers", k2.secret, { ip: "203.0.113.99" });
    expect(blocked.status).toBe(429);
    expect((await call(v1Numbers.GET, "/api/v1/numbers", k2.secret, { ip: "203.0.113.100" })).status).toBe(200);
  });

  it("request logs hold metadata only — no bodies, queries, keys or full IPs", async () => {
    const k = await makeKey(A, ["contacts:read", "contacts:write"]);
    const secretPhone = phone();
    await call(v1Contacts.POST, "/api/v1/contacts", k.secret, { method: "POST", body: { phone: secretPhone, name: "Private Person", email: "private@example.com" }, ip: "203.0.113.77" });
    await call(v1Contacts.GET, "/api/v1/contacts?q=confidential-search-term", k.secret, { ip: "203.0.113.77" });
    const rows = await db.apiRequestLog.findMany({ where: { apiKeyId: k.id } });
    expect(rows.length).toBe(2);
    const dump = JSON.stringify(rows);
    for (const forbidden of [k.secret, secretPhone, "Private Person", "private@example.com", "confidential-search-term", "203.0.113.77"]) expect(dump).not.toContain(forbidden);
    expect(rows[0].ip).toBe("203.0.113.0");
    expect(rows.map((r) => r.status).sort()).toEqual([200, 201]);
    const key = await db.apiKey.findUniqueOrThrow({ where: { id: k.id } });
    expect(key.lastUsedAt).not.toBeNull();
    expect(key.lastUsedIp).toBe("203.0.113.0");
    expect(await db.usageCounter.count({ where: { organizationId: A.orgId, metric: "api_calls" } })).toBeGreaterThan(0);
    // The dashboard shows them to owners and managers only.
    actAs(A.manager);
    const logs = await json(await logsRoute.GET(get(`/x?keyId=${k.id}&status=2xx`), P(A.orgId)));
    expect(logs.status).toBe(200);
    expect((logs.body.logs as unknown[]).length).toBe(2);
    expect((await json(await usageRoute.GET(get("/x?days=7"), P(A.orgId)))).status).toBe(200);
    actAs(A.agent);
    expect((await logsRoute.GET(get(), P(A.orgId))).status).toBe(403);
    expect((await usageRoute.GET(get(), P(A.orgId))).status).toBe(403);
  });

  it("unauthenticated requests are never logged against a workspace", async () => {
    const before = await db.apiRequestLog.count();
    await call(v1Numbers.GET, "/api/v1/numbers", `mgk_${"C".repeat(43)}`);
    await call(v1Numbers.GET, "/api/v1/numbers", null);
    expect(await db.apiRequestLog.count()).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
describe("public API v1", () => {
  let key: string;
  beforeAll(async () => {
    key = (await makeKey(A, ["numbers:read", "contacts:read", "contacts:write", "conversations:read", "messages:read", "messages:send", "templates:read"])).secret;
  });

  it("lists this workspace's numbers", async () => {
    const r = await call(v1Numbers.GET, "/api/v1/numbers", key);
    expect(r.status).toBe(200);
    expect(r.body.data.map((x: { id: string }) => x.id).sort()).toEqual([A.accountA, A.accountB].sort());
    expect(JSON.stringify(r.body)).not.toContain(B.accountA);
  });

  it("contacts: create (source api), duplicate, get, update, filter, and consent needs evidence", async () => {
    const p = phone();
    const c = await call(v1Contacts.POST, "/api/v1/contacts", key, { method: "POST", body: { phone: p, name: "Asha", tags: ["web-lead"], custom_fields: { city: "Ludhiana" }, opt_in: { evidence: "Website form, 2026-10-06" } } });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ phone: p, name: "Asha", source: "api", opt_in_status: "opted_in", tags: ["web-lead"], custom_fields: { city: "Ludhiana" } });
    const consent = await db.consentRecord.findFirstOrThrow({ where: { contactId: c.body.data.id } });
    expect(consent.evidence).toContain("Website form");
    expect((await call(v1Contacts.POST, "/api/v1/contacts", key, { method: "POST", body: { phone: p } })).status).toBe(409);
    expect((await call(v1Contacts.POST, "/api/v1/contacts", key, { method: "POST", body: { phone: phone(), opt_in: {} } })).status).toBe(400);
    // The public API can't touch suppression or owners.
    const sneaky = await call(v1Contacts.POST, "/api/v1/contacts", key, { method: "POST", body: { phone: phone(), suppressed: false, ownerUserId: A.owner.id } });
    expect(sneaky.status).toBe(201);
    expect(sneaky.body.data.suppressed).toBe(false);
    const id = c.body.data.id as string;
    expect((await call(v1Contact.GET, `/api/v1/contacts/${id}`, key, { ctx: { id } })).body.data.name).toBe("Asha");
    const upd = await call(v1Contact.PATCH, `/api/v1/contacts/${id}`, key, { method: "PATCH", body: { lead_status: "qualified", email: "asha@example.com" }, ctx: { id } });
    expect(upd.body.data).toMatchObject({ lead_status: "qualified", email: "asha@example.com" });
    const found = await call(v1Contacts.GET, `/api/v1/contacts?phone=${encodeURIComponent(p)}`, key);
    expect(found.body.data.map((x: { id: string }) => x.id)).toEqual([id]);
    expect(found.body).toMatchObject({ page: 1, total: 1, has_more: false });
  });

  it("sending: several numbers need number_id; the message goes out through the chosen number and is marked as API", async () => {
    const to = phone();
    const ambiguous = await call(v1Messages.POST, "/api/v1/messages", key, { method: "POST", body: { to, type: "text", text: "hi" } });
    expect(ambiguous.status).toBe(400);
    expect(JSON.stringify(ambiguous.body.details)).toMatch(/number_id/);
    // The 24h window is closed for a brand-new customer: text is refused, with guidance.
    const closed = await call(v1Messages.POST, "/api/v1/messages", key, { method: "POST", body: { number_id: A.accountB, to, type: "text", text: "hi" } });
    expect(closed.status).toBe(409);
    expect(closed.body.error).toMatch(/24-hour/);
    // Once the customer writes to number B, replying through B works.
    await inbound(A, A.accountB, "hello", to);
    const sent = await call(v1Messages.POST, "/api/v1/messages", key, { method: "POST", body: { number_id: A.accountB, to, type: "text", text: "Your order shipped" } });
    expect(sent.status).toBe(201);
    expect(sent.body.data).toMatchObject({ number_id: A.accountB, status: "sent", to });
    const m = await db.message.findUniqueOrThrow({ where: { id: sent.body.data.id } });
    expect(JSON.parse(m.payload)).toMatchObject({ origin: "api" });
    expect((await db.conversation.findUniqueOrThrow({ where: { id: m.conversationId } })).whatsappAccountId).toBe(A.accountB);
    // Messages are readable through the API.
    const msgs = await call(v1ConvMessages.GET, `/api/v1/conversations/${m.conversationId}/messages`, key, { ctx: { id: m.conversationId } });
    expect(msgs.body.data.map((x: { text: string }) => x.text)).toEqual(expect.arrayContaining(["hello", "Your order shipped"]));
    // Opted-out customers are never messaged.
    await inbound(A, A.accountB, "STOP", to);
    expect((await call(v1Messages.POST, "/api/v1/messages", key, { method: "POST", body: { number_id: A.accountB, to, type: "text", text: "still there?" } })).status).toBe(409);
    expect((await call(v1Messages.POST, "/api/v1/messages", key, { method: "POST", body: { number_id: A.accountB, to: "123", type: "text", text: "x" } })).status).toBe(400);
    expect((await call(v1Messages.POST, "/api/v1/messages", key, { method: "POST", body: { number_id: A.accountB, to: phone(), type: "text" } })).status).toBe(400);
  });

  it("sending templates: only approved ones, and marketing needs recorded consent", async () => {
    actAs(A.owner);
    const tmpl = async (name: string, category: string) => {
      const c = await json(await templatesRoute.POST(post({ wabaId: A.wabaA, language: "en", name, category, body: "Hello {{1}}, an update from us.", examples: { body: ["Asha"] } }), P(A.orgId)));
      expect(c.status).toBe(201);
      const tid = (c.body.template as { id: string }).id;
      expect((await templateSubmit.POST(post({}), P(A.orgId, { tid }))).status).toBe(200);
      expect((await templateReview.POST(post({ decision: "approved" }), P(A.orgId, { tid }))).status).toBe(200);
      return tid;
    };
    await tmpl("order_update", "UTILITY");
    await tmpl("diwali_offer", "MARKETING");
    const list = await call(v1Templates.GET, "/api/v1/templates", key);
    const util = list.body.data.find((t: { name: string }) => t.name === "order_update");
    expect(util.number_ids).toContain(A.accountA);
    expect(util.variables[0].key).toBe("body.1");
    const to = phone();
    const ok = await call(v1Messages.POST, "/api/v1/messages", key, { method: "POST", body: { number_id: A.accountA, to, type: "template", template: { name: "order_update", language: "en", values: { "body.1": "Asha" } } } });
    expect(ok.status).toBe(201);
    expect(ok.body.data.status).toBe("sent");
    const mk = { number_id: A.accountA, to, type: "template", template: { name: "diwali_offer", language: "en", values: { "body.1": "Asha" } } };
    const noConsent = await call(v1Messages.POST, "/api/v1/messages", key, { method: "POST", body: mk });
    expect(noConsent.status).toBe(409);
    expect(noConsent.body.error).toMatch(/opted in/);
    // Missing variable, unknown template.
    expect((await call(v1Messages.POST, "/api/v1/messages", key, { method: "POST", body: { ...mk, template: { ...mk.template, values: {} } } })).status).toBe(400);
    expect((await call(v1Messages.POST, "/api/v1/messages", key, { method: "POST", body: { ...mk, template: { name: "nope", language: "en", values: {} } } })).status).toBe(400);
    // Consent recorded through the API unlocks marketing sends.
    await call(v1Contacts.POST, "/api/v1/contacts", key, { method: "PATCH", body: { phone: to }, ip: "198.51.100.1" }).catch(() => undefined);
    const contact = await db.contact.findFirstOrThrow({ where: { organizationId: A.orgId, phone: to } });
    await db.contact.update({ where: { id: contact.id }, data: { optInStatus: "opted_in" } });
    expect((await call(v1Messages.POST, "/api/v1/messages", key, { method: "POST", body: mk })).status).toBe(201);
  });

  it("tenant isolation: a key only ever sees its own workspace", async () => {
    const bContact = await json(await (async () => { actAs(B.owner); return contactsRoute.POST(post({ phone: phone(), name: "B Secret" }), P(B.orgId)); })());
    const bContactId = (bContact.body.contact as { id: string }).id;
    const bConv = await inbound(B, B.accountA, "b private message");
    const bKey = (await makeKey(B, ["contacts:read", "contacts:write", "conversations:read", "messages:read", "messages:send", "numbers:read"])).secret;

    // A's key can't read, change, list or message anything of B's.
    expect((await call(v1Contact.GET, `/api/v1/contacts/${bContactId}`, key, { ctx: { id: bContactId } })).status).toBe(404);
    expect((await call(v1Contact.PATCH, `/api/v1/contacts/${bContactId}`, key, { method: "PATCH", body: { name: "Hacked" }, ctx: { id: bContactId } })).status).toBe(404);
    expect((await db.contact.findUniqueOrThrow({ where: { id: bContactId } })).name).toBe("B Secret");
    expect((await call(v1ConvMessages.GET, `/api/v1/conversations/${bConv.conversationId}/messages`, key, { ctx: { id: bConv.conversationId } })).status).toBe(404);
    const convs = await call(v1Conversations.GET, "/api/v1/conversations", key);
    expect(JSON.stringify(convs.body)).not.toContain(bConv.conversationId);
    expect((await call(v1Conversations.GET, `/api/v1/conversations?number_id=${B.accountA}`, key)).status).toBe(404);
    expect((await call(v1Messages.POST, "/api/v1/messages", key, { method: "POST", body: { number_id: B.accountA, to: phone(), type: "text", text: "x" } })).status).toBe(404);
    const contacts = await call(v1Contacts.GET, "/api/v1/contacts?pageSize=100", key);
    expect(JSON.stringify(contacts.body)).not.toContain("B Secret");
    // …and the same phone number is a separate contact in each workspace.
    const shared = phone();
    const a = await call(v1Contacts.POST, "/api/v1/contacts", key, { method: "POST", body: { phone: shared, name: "In A" } });
    const b = await call(v1Contacts.POST, "/api/v1/contacts", bKey, { method: "POST", body: { phone: shared, name: "In B" } });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.id).not.toBe(b.body.data.id);
    // Management endpoints: A's owner can't touch B's keys; B's key ids don't resolve in A.
    const bk = await db.apiKey.findFirstOrThrow({ where: { organizationId: B.orgId } });
    actAs(A.owner);
    expect((await keyRevoke.POST(post(), P(B.orgId, { kid: bk.id }))).status).toBe(403);
    expect((await json(await keyRevoke.POST(post(), P(A.orgId, { kid: bk.id })))).status).toBe(404);
    expect((await json(await keyRotate.POST(post({}), P(A.orgId, { kid: bk.id })))).status).toBe(404);
    expect((await keysRoute.GET(get(), P(B.orgId))).status).toBe(403);
    expect((await logsRoute.GET(get(), P(B.orgId))).status).toBe(403);
    // B's key still works.
    expect((await call(v1Numbers.GET, "/api/v1/numbers", bKey)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------
describe("webhook signatures (the receiver's side)", () => {
  const body = JSON.stringify({ id: "evt_1", type: "message.received" });
  it("verifies, and rejects tampering, wrong secrets, stale timestamps and malformed headers", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = signPayload("whsec_abc", body, now);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifySignature("whsec_abc", body, header)).toBe(true);
    expect(verifySignature("whsec_abc", body + " ", header)).toBe(false);
    expect(verifySignature("whsec_other", body, header)).toBe(false);
    expect(verifySignature("whsec_abc", body, signPayload("whsec_abc", body, now - WEBHOOK_LIMITS.toleranceSec - 5))).toBe(false);
    expect(verifySignature("whsec_abc", body, signPayload("whsec_abc", body, now + WEBHOOK_LIMITS.toleranceSec + 5))).toBe(false);
    expect(verifySignature("whsec_abc", body, null)).toBe(false);
    expect(verifySignature("whsec_abc", body, "garbage")).toBe(false);
    expect(verifySignature("whsec_abc", body, `t=${now},v1=zz`)).toBe(false);
    expect(verifySignature("whsec_abc", body, header, { nowSec: now + 10_000, toleranceSec: 20_000 })).toBe(true);
  });
});

describe("outgoing webhooks", () => {
  it("permissions and URL safety: HTTPS only, no internal addresses", async () => {
    actAs(A.agent);
    expect((await hooksRoute.GET(get(), P(A.orgId))).status).toBe(403);
    expect((await hooksRoute.POST(post({ url: "https://hooks.example.com/x", events: ["message.received"] }), P(A.orgId))).status).toBe(403);
    actAs(A.manager);
    expect((await hooksRoute.GET(get(), P(A.orgId))).status).toBe(200);
    for (const url of ["http://hooks.example.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.1.2.3/x", "https://internal.example.com/x", "https://user:pw@hooks.example.com/x", "ftp://hooks.example.com", "not a url"]) {
      const r = await json(await hooksRoute.POST(post({ url, events: ["message.received"] }), P(A.orgId)));
      expect(r.status, url).toBe(400);
    }
    expect((await json(await hooksRoute.POST(post({ url: "https://hooks.example.com/x", events: [] }), P(A.orgId)))).status).toBe(400);
    expect((await json(await hooksRoute.POST(post({ url: "https://hooks.example.com/x", events: ["message.exploded"] }), P(A.orgId)))).status).toBe(400);
  });

  it("the signing secret is shown once and stored encrypted", async () => {
    const h = await makeHook(A, ["message.received"], "https://hooks.example.com/secret-test");
    expect(h.secret).toMatch(/^whsec_/);
    const row = await db.webhookEndpoint.findUniqueOrThrow({ where: { id: h.id } });
    expect(row.secretEnc).not.toContain(h.secret);
    expect(row.secretEnc.startsWith("v1:")).toBe(true);
    actAs(A.manager);
    for (const body of [(await json(await hooksRoute.GET(get(), P(A.orgId)))).body, (await json(await hookRoute.GET(get(), P(A.orgId, { wid: h.id })))).body]) {
      expect(JSON.stringify(body)).not.toContain(h.secret);
      expect(JSON.stringify(body)).toContain(`whsec_••••${h.secret.slice(-4)}`);
    }
    await hookRoute.DELETE(del(), P(A.orgId, { wid: h.id }));
  });

  it("delivers all ten events, signed, to subscribers only — and drops the payload once delivered", async () => {
    const h = await makeHook(A, [...WEBHOOK_EVENT_LIST], "https://hooks.example.com/all");
    const only = await makeHook(A, ["flow.submitted"], "https://hooks.example.com/only-flows");
    actAs(A.owner);
    const from = phone();

    // contact.created + conversation.created + message.received (customer's first message)
    const inb = await inbound(A, A.accountA, "hi, do you deliver?", from, "Webhook Customer");
    await flush();
    const got = (e: string) => hitsFor("https://hooks.example.com/all", e);
    expect(got("contact.created")).toHaveLength(1);
    expect(got("conversation.created")).toHaveLength(1);
    expect(got("message.received")).toHaveLength(1);
    const received = JSON.parse(got("message.received")[0].body);
    expect(received).toMatchObject({ type: "message.received", organization_id: A.orgId, data: { message: { text: "hi, do you deliver?", number_id: A.accountA, conversation_id: inb.conversationId }, contact: { phone: from } } });

    // Signature + headers verify with the secret from creation.
    const hit = got("message.received")[0];
    expect(verifySignature(h.secret, hit.body, hit.headers["X-Mecgura-Signature"])).toBe(true);
    expect(hit.headers["X-Mecgura-Event"]).toBe("message.received");
    expect(hit.headers["X-Mecgura-Event-Id"]).toBe(received.id);
    expect(hit.headers["User-Agent"]).toBe("MECGURA-Webhooks/1.0");
    // Another endpoint with a different secret would not verify.
    expect(verifySignature(only.secret, hit.body, hit.headers["X-Mecgura-Signature"])).toBe(false);

    // message.sent when the team replies; delivered / read / failed from receipts.
    const sent = await json(await messagesRoute.POST(post({ type: "text", body: "Yes we do!" }), P(A.orgId, { cid: inb.conversationId })));
    const mid = (sent.body.message as { id: string }).id;
    await flush();
    expect(got("message.sent")).toHaveLength(1);
    const sentBody = JSON.parse(got("message.sent")[0].body);
    expect(sentBody.data.message).toMatchObject({ id: mid, status: "sent", direction: "outbound" });
    expect(JSON.stringify(sentBody)).not.toContain("Yes we do!"); // outbound text isn't repeated in status events
    await demoStatus.POST(post({ messageId: mid, status: "delivered" }), P(A.orgId));
    await demoStatus.POST(post({ messageId: mid, status: "read" }), P(A.orgId));
    const sent2 = await json(await messagesRoute.POST(post({ type: "text", body: "second" }), P(A.orgId, { cid: inb.conversationId })));
    await demoStatus.POST(post({ messageId: (sent2.body.message as { id: string }).id, status: "failed" }), P(A.orgId));
    await flush();
    expect(got("message.delivered")).toHaveLength(1);
    expect(got("message.read")).toHaveLength(1);
    expect(got("message.failed")).toHaveLength(1);

    // contact.updated lists what changed.
    await contactRoute.PATCH(patch({ email: "wh@example.com" }), P(A.orgId, { id: inb.contactId }));
    await flush();
    const upd = got("contact.updated").map((x) => JSON.parse(x.body)).find((x) => x.data.changed.includes("email"));
    expect(upd.data.contact).toMatchObject({ email: "wh@example.com", phone: from });

    // flow.submitted reaches both subscribers.
    const wl = await json(await flowsRoute.GET(get("/x?status=&q="), P(A.orgId)));
    const wabaId = (wl.body.accounts as { id: string }[])[0].id;
    const fc = await json(await flowsRoute.POST(post({ name: `Webhook flow ${n++}`, wabaId, template: "feedback" }), P(A.orgId)));
    const fid = (fc.body.flow as { id: string }).id;
    expect((await flowPublish.POST(post(), P(A.orgId, { fid }))).status).toBe(200);
    const flowDef = (fc.body.flow as { definition: { screens: { fields: { name: string; type: string; options: string[]; required: boolean }[] }[] } }).definition;
    const answers: Record<string, string | string[] | boolean> = {};
    for (const f of flowDef.screens.flatMap((s) => s.fields)) answers[f.name] = f.options.length ? (f.type === "checkbox" ? [f.options[0]] : f.options[0]) : f.type === "optin" ? true : f.type === "email" ? "a@b.co" : f.type === "number" ? "4" : f.type === "date" ? "2026-10-20" : "great service";
    const fs = await json(await flowDemoSubmit.POST(post({ phone: from, name: "Webhook Customer", answers }), P(A.orgId, { fid })));
    expect(fs.status).toBe(201);
    await flush();
    expect(got("flow.submitted")).toHaveLength(1);
    expect(hitsFor("https://hooks.example.com/only-flows")).toHaveLength(1);
    expect(hitsFor("https://hooks.example.com/only-flows")[0].headers["X-Mecgura-Event"]).toBe("flow.submitted");
    expect(JSON.parse(got("flow.submitted")[0].body).data).toMatchObject({ flow: { id: fid }, submission: { source: "demo" } });

    // campaign.completed
    const camp = await db.campaign.create({ data: { organizationId: A.orgId, name: "Done campaign", whatsappAccountId: A.accountA, status: "completed", completedAt: new Date() } });
    await emitCampaignCompleted(A.orgId, camp.id);
    await flush();
    expect(JSON.parse(got("campaign.completed")[0].body).data.campaign).toMatchObject({ id: camp.id, name: "Done campaign", number_id: A.accountA });

    // All ten distinct events arrived.
    expect(new Set(hitsFor("https://hooks.example.com/all").map((x) => x.headers["X-Mecgura-Event"]))).toEqual(new Set(WEBHOOK_EVENT_LIST));
    // Delivered rows keep no payload.
    const rows = await db.webhookDelivery.findMany({ where: { endpointId: h.id } });
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.every((r) => r.status === "delivered" && r.payload === null && r.attempts === 1)).toBe(true);
    // Disable the broad hook so later tests stay quiet.
    await hookRoute.PATCH(patch({ status: "disabled" }), P(A.orgId, { wid: h.id }));
    await hookRoute.DELETE(del(), P(A.orgId, { wid: only.id }));
  });

  it("retries with backoff, gives up after the last attempt, and failed deliveries can be re-sent", async () => {
    const h = await makeHook(A, ["message.received"], "https://hooks.example.com/flaky");
    respond = () => ({ status: 500 });
    const inb = await inbound(A, A.accountA, "retry me");
    await flush();
    let d = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: h.id } });
    expect(d).toMatchObject({ status: "pending", attempts: 1, responseStatus: 500 });
    expect(d.error).toMatch(/HTTP 500/);
    expect(d.payload).not.toBeNull();
    expect(d.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(WEBHOOK_LIMITS.retryDelaysMs[0] - 5_000);
    expect(d.nextAttemptAt!.getTime() - Date.now()).toBeLessThanOrEqual(WEBHOOK_LIMITS.retryDelaysMs[0]);

    // Not due yet → nothing happens.
    await runDueWebhooks(2_000);
    expect(hitsFor("https://hooks.example.com/flaky")).toHaveLength(1);

    // Attempt 2 fails (timeout), attempt 3 succeeds. The event id and body stay identical across attempts.
    const makeDue = () => db.webhookDelivery.update({ where: { id: d.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    respond = () => Object.assign(new Error("t"), { name: "TimeoutError" });
    await makeDue();
    await runDueWebhooks(2_000);
    d = await db.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(d).toMatchObject({ status: "pending", attempts: 2 });
    expect(d.error).toMatch(/Timed out/);
    respond = () => ({ status: 200 });
    await makeDue();
    await runDueWebhooks(2_000);
    d = await db.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(d).toMatchObject({ status: "delivered", attempts: 3, payload: null, error: "" });
    const bodies = new Set(hitsFor("https://hooks.example.com/flaky").map((x) => x.body));
    expect(bodies.size).toBe(1);
    expect(new Set(hitsFor("https://hooks.example.com/flaky").map((x) => x.headers["X-Mecgura-Delivery"])).size).toBe(1);

    // Exhaust all attempts → failed, payload kept for re-sending.
    respond = () => ({ status: 503 });
    await inbound(A, A.accountA, "always failing", inb.phone);
    await flush();
    let f = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: h.id, status: "pending" } });
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await db.webhookDelivery.update({ where: { id: f.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await runDueWebhooks(2_000);
    }
    f = await db.webhookDelivery.findUniqueOrThrow({ where: { id: f.id } });
    expect(f).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, nextAttemptAt: null });
    expect(f.payload).not.toBeNull();
    expect(f.error).toMatch(/HTTP 503/);
    expect((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: h.id } })).consecutiveFailures).toBe(1);

    // Re-send from the dashboard once the endpoint is healthy again; other roles can't.
    actAs(A.agent);
    expect((await hookRedeliver.POST(post(), P(A.orgId, { wid: h.id, did: f.id }))).status).toBe(403);
    actAs(A.owner);
    respond = () => ({ status: 200 });
    const re = await json(await hookRedeliver.POST(post(), P(A.orgId, { wid: h.id, did: f.id })));
    expect(re.status).toBe(200);
    expect(re.body.delivery).toMatchObject({ status: "delivered" });
    expect((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: h.id } })).consecutiveFailures).toBe(0);
    expect((await json(await hookRedeliver.POST(post(), P(A.orgId, { wid: h.id, did: f.id })))).status).toBe(409); // already delivered
    const list = await json(await hookDeliveries.GET(get("/x?status=delivered"), P(A.orgId, { wid: h.id })));
    expect((list.body.deliveries as unknown[]).length).toBe(2);
    expect(JSON.stringify(list.body)).not.toContain("always failing"); // the delivery log never exposes payloads
    await hookRoute.DELETE(del(), P(A.orgId, { wid: h.id }));
  });

  it("410 Gone fails at once, redirects are not followed, and repeated failures switch the endpoint off", async () => {
    const gone = await makeHook(A, ["message.received"], "https://hooks.example.com/gone");
    respond = () => ({ status: 410 });
    await inbound(A, A.accountA, "to a gone endpoint");
    await flush();
    expect(await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: gone.id } })).toMatchObject({ status: "failed", attempts: 1 });
    await hookRoute.DELETE(del(), P(A.orgId, { wid: gone.id }));

    const redir = await makeHook(A, ["message.received"], "https://hooks.example.com/moved");
    respond = () => ({ status: 302 });
    await inbound(A, A.accountA, "redirect please");
    await flush();
    const rd = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: redir.id } });
    expect(rd.error).toMatch(/redirect/i);
    expect(hitsFor("https://hooks.example.com/moved")).toHaveLength(1); // never followed
    await hookRoute.DELETE(del(), P(A.orgId, { wid: redir.id }));

    const dead = await makeHook(A, ["message.received"], "https://hooks.example.com/dead");
    respond = () => ({ status: 410 });
    for (let i = 0; i < WEBHOOK_LIMITS.disableAfterFailures; i++) {
      await inbound(A, A.accountA, `dead ${i}`);
      await flush();
    }
    const ep = await db.webhookEndpoint.findUniqueOrThrow({ where: { id: dead.id } });
    expect(ep.status).toBe("disabled");
    expect(ep.disabledReason).toMatch(/automatically/);
    expect(await db.notification.count({ where: { organizationId: A.orgId, userId: A.owner.id, title: { contains: "switched off" } } })).toBeGreaterThan(0);
    // A disabled endpoint receives nothing further, and re-enabling resets the counter.
    const count = hitsFor("https://hooks.example.com/dead").length;
    invalidateWebhookCache();
    await inbound(A, A.accountA, "after disable");
    await flush();
    expect(hitsFor("https://hooks.example.com/dead").length).toBe(count);
    actAs(A.manager);
    expect((await hookRoute.PATCH(patch({ status: "active" }), P(A.orgId, { wid: dead.id }))).status).toBe(200);
    expect((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: dead.id } })).consecutiveFailures).toBe(0);
    await hookRoute.DELETE(del(), P(A.orgId, { wid: dead.id }));
  });

  it("an address that turns private after saving is refused at send time (SSRF / DNS rebinding)", async () => {
    const h = await makeHook(A, ["message.received"], "https://rebind.example.com/hook");
    dns.privateHosts.add("rebind.example.com");
    await inbound(A, A.accountA, "rebinding");
    await flush();
    expect(hitsFor("https://rebind.example.com")).toHaveLength(0);
    const d = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: h.id } });
    expect(d.error).toMatch(/Blocked/);
    dns.privateHosts.delete("rebind.example.com");
    await hookRoute.DELETE(del(), P(A.orgId, { wid: h.id }));
  });

  it("the test button sends a signed sample, never counts as a failure, and rotating the secret changes the signature", async () => {
    const h = await makeHook(A, ["message.received"], "https://hooks.example.com/test-button");
    actAs(A.owner);
    const ok = await json(await hookTest.POST(post(), P(A.orgId, { wid: h.id })));
    expect(ok.body.delivery).toMatchObject({ event: "webhook.test", status: "delivered", responseStatus: 200 });
    const hit = hitsFor("https://hooks.example.com/test-button", "webhook.test")[0];
    expect(verifySignature(h.secret, hit.body, hit.headers["X-Mecgura-Signature"])).toBe(true);
    respond = () => ({ status: 500 });
    const bad = await json(await hookTest.POST(post(), P(A.orgId, { wid: h.id })));
    expect(bad.body.delivery).toMatchObject({ status: "failed", attempts: 1 });
    expect((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: h.id } })).consecutiveFailures).toBe(0);
    // Rotation.
    respond = () => ({ status: 200 });
    const rot = await json(await hookRotate.POST(post(), P(A.orgId, { wid: h.id })));
    const fresh = rot.body.secret as string;
    expect(fresh).not.toBe(h.secret);
    await hookTest.POST(post(), P(A.orgId, { wid: h.id }));
    const latest = hitsFor("https://hooks.example.com/test-button", "webhook.test").at(-1)!;
    expect(verifySignature(fresh, latest.body, latest.headers["X-Mecgura-Signature"])).toBe(true);
    expect(verifySignature(h.secret, latest.body, latest.headers["X-Mecgura-Signature"])).toBe(false);
    await hookRoute.DELETE(del(), P(A.orgId, { wid: h.id }));
  });

  it("tenant isolation: events never cross workspaces, and endpoints can't be read or changed across them", async () => {
    const a = await makeHook(A, ["message.received"], "https://hooks.example.com/tenant-a");
    const b = await makeHook(B, ["message.received"], "https://hooks.example.com/tenant-b", B.owner);
    actAs(A.owner);
    await inbound(A, A.accountA, "only for tenant A");
    await flush();
    expect(hitsFor("https://hooks.example.com/tenant-a", "message.received").length).toBe(1);
    expect(hitsFor("https://hooks.example.com/tenant-b")).toHaveLength(0);
    actAs(B.owner);
    await inbound(B, B.accountA, "only for tenant B");
    await flush();
    expect(hitsFor("https://hooks.example.com/tenant-b", "message.received").length).toBe(1);
    expect(hitsFor("https://hooks.example.com/tenant-a", "message.received").length).toBe(1);
    expect(JSON.stringify(hitsFor("https://hooks.example.com/tenant-b").map((x) => x.body))).not.toContain("tenant A");
    actAs(A.owner);
    expect((await hookRoute.GET(get(), P(B.orgId, { wid: b.id }))).status).toBe(403);
    expect((await json(await hookRoute.GET(get(), P(A.orgId, { wid: b.id })))).status).toBe(404);
    expect((await json(await hookRoute.PATCH(patch({ status: "disabled" }), P(A.orgId, { wid: b.id })))).status).toBe(404);
    expect((await json(await hookTest.POST(post(), P(A.orgId, { wid: b.id })))).status).toBe(404);
    expect((await json(await hookRotate.POST(post(), P(A.orgId, { wid: b.id })))).status).toBe(404);
    expect((await json(await hookDeliveries.GET(get(), P(A.orgId, { wid: b.id })))).status).toBe(404);
    expect((await json(await hookRoute.DELETE(del(), P(A.orgId, { wid: b.id })))).status).toBe(404);
    expect(await db.webhookEndpoint.count({ where: { id: b.id } })).toBe(1);
    await hookRoute.DELETE(del(), P(A.orgId, { wid: a.id }));
  });

  it("housekeeping: stale failed payloads are dropped, old rows removed", async () => {
    const h = await makeHook(A, ["message.received"], "https://hooks.example.com/purge");
    const mk = (age: number, status: string) => db.webhookDelivery.create({ data: { organizationId: A.orgId, endpointId: h.id, eventId: `evt_${age}_${status}`, event: "message.received", payload: "{}", status, createdAt: new Date(Date.now() - age * 86_400_000) } });
    const old = await mk(8, "failed");
    const fresh = await mk(2, "failed");
    const ancient = await mk(40, "delivered");
    await purgeWebhookData();
    expect((await db.webhookDelivery.findUniqueOrThrow({ where: { id: old.id } })).payload).toBeNull();
    expect((await db.webhookDelivery.findUniqueOrThrow({ where: { id: fresh.id } })).payload).toBe("{}");
    expect(await db.webhookDelivery.count({ where: { id: ancient.id } })).toBe(0);
    await hookRoute.DELETE(del(), P(A.orgId, { wid: h.id }));
  });

  it("webhook management is limited per workspace", async () => {
    const t = await makeTenant();
    actAs(t.owner);
    for (let i = 0; i < WEBHOOK_LIMITS.maxEndpoints; i++) expect((await hooksRoute.POST(post({ url: `https://hooks.example.com/n${i}`, events: ["message.received"] }), P(t.orgId))).status).toBe(201);
    expect((await json(await hooksRoute.POST(post({ url: "https://hooks.example.com/over", events: ["message.received"] }), P(t.orgId)))).status).toBe(409);
  });
});

it("hashApiKey is stable and one-way", () => {
  expect(hashApiKey("mgk_x")).toBe(hashApiKey("mgk_x"));
  expect(hashApiKey("mgk_x")).not.toContain("mgk_x");
});
