import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { Client } from "./http-client";

/**
 * Large-data check against a RUNNING server: one workspace with 30,000 contacts, 3,000 conversations,
 * 60,000 messages (one conversation holds 5,000), 300 campaigns. Every list/analytics endpoint must
 * answer within budget and must never return an unbounded payload.
 */
const PASSWORD = `Perf-${randomBytes(6).toString("hex")}1`;
const tag = Date.now().toString(36);
const email = `perf-${tag}@e2e.local`;
const BUDGET_MS = Number(process.env.PERF_BUDGET_MS ?? 2500);
const CONTACTS = 30_000;
const CONVERSATIONS = 3_000;
const MESSAGES = 60_000;
let orgId = "";
let bigConv = "";
let client: Client;

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await db.user.create({ data: { email, name: "Perf Owner", passwordHash } });
  const org = await db.organization.create({ data: { name: `Perf Org ${tag}`, slug: `perf-${tag}` } });
  orgId = org.id;
  await db.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "CLIENT_OWNER" } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  const plan = await db.plan.findFirst({ where: { slug: "enterprise" } });
  if (plan) await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });

  client = new Client();
  expect(await client.login(email, PASSWORD)).toBe(true);
  const conn = await client.fetch(`/api/organizations/${org.id}/whatsapp/connect/demo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessName: "Perf Store" }) });
  expect(conn.status).toBe(201);
  const acct = await db.whatsAppAccount.findFirstOrThrow({ where: { organizationId: org.id } });

  const rows = Array.from({ length: CONTACTS }, (_, i) => ({ organizationId: org.id, name: `Perf Contact ${i}`, phone: `+9190${String(i).padStart(8, "0")}`, source: "import", optInStatus: i % 3 ? "opted_in" : "unknown" }));
  for (const c of chunks(rows, 5000)) await db.contact.createMany({ data: c });
  const contacts = await db.contact.findMany({ where: { organizationId: org.id }, select: { id: true }, take: CONVERSATIONS });
  const now = Date.now();
  await db.conversation.createMany({ data: contacts.map((c, i) => ({ organizationId: org.id, contactId: c.id, whatsappAccountId: acct.id, lastMessageAt: new Date(now - i * 60_000), lastMessagePreview: "hello" })) });
  const convs = await db.conversation.findMany({ where: { organizationId: org.id }, select: { id: true } });
  bigConv = convs[0].id;
  const msgs = Array.from({ length: MESSAGES }, (_, i) => {
    const conversationId = i < 5000 ? bigConv : convs[i % convs.length].id;
    const inbound = i % 2 === 0;
    const at = new Date(now - (MESSAGES - i) * 30_000);
    return { organizationId: org.id, conversationId, direction: inbound ? "inbound" : "outbound", type: "text", body: `message ${i}`, status: inbound ? "received" : "read", createdAt: at, sentAt: at, deliveredAt: inbound ? null : at, readAt: inbound ? null : at };
  });
  for (const c of chunks(msgs, 5000)) await db.message.createMany({ data: c });
  await db.campaign.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ organizationId: org.id, name: `Perf campaign ${i}`, whatsappAccountId: acct.id, status: i % 2 ? "completed" : "draft" })) });
}, 600_000);

afterAll(async () => {
  // Delete the big tables explicitly first — a single cascading delete over ~100k rows is very slow on SQLite.
  const where = { organizationId: orgId };
  await db.message.deleteMany({ where });
  await db.conversation.deleteMany({ where });
  await db.campaign.deleteMany({ where });
  await db.contact.deleteMany({ where });
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.user.deleteMany({ where: { email } });
}, 600_000);

async function timed(path: string) {
  const t0 = performance.now();
  // The first call after the long seeding may land on a keep-alive socket the server already closed.
  const res = await client.fetch(`/api/organizations/${orgId}${path}`).catch(async (e: unknown) => {
    console.warn(`retrying ${path}: ${String((e as { cause?: unknown }).cause ?? e)}`);
    await new Promise((r) => setTimeout(r, 1500));
    return client.fetch(`/api/organizations/${orgId}${path}`);
  });
  const text = await res.text();
  return { status: res.status, ms: Math.round(performance.now() - t0), bytes: text.length, json: JSON.parse(text) as Record<string, unknown> };
}

describe(`large workspace: ${CONTACTS} contacts, ${CONVERSATIONS} conversations, ${MESSAGES} messages`, () => {
  const cases: [string, string, number][] = [
    ["contacts, first page", "/contacts?page=1&pageSize=25", 100_000],
    ["contacts, deep page", "/contacts?page=1000&pageSize=25", 100_000],
    ["contacts, search", "/contacts?q=Contact%2029999", 100_000],
    ["contacts, filtered", "/contacts?leadStatus=new&pageSize=50", 200_000],
    ["contacts, largest allowed page", "/contacts?pageSize=100", 300_000],
    ["inbox conversation list", "/inbox/conversations", 600_000],
    ["campaign list", "/campaigns", 600_000],
    ["automation list", "/automations", 100_000],
    ["template list", "/templates", 100_000],
    ["analytics (30 days)", "/analytics?days=30", 200_000],
    ["billing usage", "/billing/usage", 100_000],
  ];
  for (const [name, path, maxBytes] of cases) {
    it(`${name} answers < ${BUDGET_MS} ms and stays bounded`, async () => {
      const r = await timed(path);
      console.log(`${name.padEnd(36)} ${String(r.ms).padStart(5)} ms  ${String(Math.round(r.bytes / 1024)).padStart(5)} KB`);
      expect(r.status).toBe(200);
      expect(r.bytes).toBeLessThan(maxBytes);
      expect(r.ms).toBeLessThan(BUDGET_MS);
    });
  }
  it("an absurd pageSize is refused instead of loading the table", async () => {
    const r = await timed("/contacts?pageSize=100000");
    expect(r.status).toBe(400);
  });
  it("a 5,000-message conversation opens with a bounded window of messages", async () => {
    const r = await timed(`/inbox/conversations/${bigConv}/messages`);
    console.log(`${"big conversation messages".padEnd(36)} ${String(r.ms).padStart(5)} ms  ${String(Math.round(r.bytes / 1024)).padStart(5)} KB`);
    expect(r.status).toBe(200);
    expect(r.ms).toBeLessThan(BUDGET_MS);
    expect(r.bytes).toBeLessThan(400_000);
  });
});
