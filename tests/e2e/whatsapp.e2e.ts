import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { BASE, Client } from "./http-client";

/** Phase 3 over real HTTP: connection center pages, demo connection, disconnect, isolation, webhook guard. */
const tag = Date.now().toString(36);
const PASSWORD = `Wa-${randomBytes(6).toString("hex")}1`;
const emails = { a: `e2e-wa-a-${tag}@e2e.local`, b: `e2e-wa-b-${tag}@e2e.local`, agent: `e2e-wa-agent-${tag}@e2e.local` };
const orgIds: string[] = [];
let planId = "";
let accountId = "";

const send = (method: string, body?: unknown) => ({ method, headers: { "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
async function login(email: string) {
  const c = new Client();
  expect(await c.login(email, PASSWORD)).toBe(true);
  return c;
}

beforeAll(async () => {
  const hash = await bcrypt.hash(PASSWORD, 10);
  planId = (await db.plan.create({ data: { name: `E2E WA ${tag}`, slug: `e2e-wa-${tag}`, priceMonthly: 0, maxUsers: 5, maxWhatsAppNumbers: 2 } })).id;
  for (const [key, role] of [["a", "CLIENT_OWNER"], ["b", "CLIENT_OWNER"]] as const) {
    const org = await db.organization.create({ data: { name: `E2E WA ${key} ${tag}`, slug: `e2e-wa-${key}-${tag}` } });
    orgIds.push(org.id);
    const u = await db.user.create({ data: { email: emails[key], name: `Owner ${key}`, passwordHash: hash } });
    await db.organizationMember.create({ data: { organizationId: org.id, userId: u.id, role } });
    await db.subscription.create({ data: { organizationId: org.id, planId, priceMonthly: 0 } });
    await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  }
  const agent = await db.user.create({ data: { email: emails.agent, name: "Agent", passwordHash: hash } });
  await db.organizationMember.create({ data: { organizationId: orgIds[0], userId: agent.id, role: "AGENT" } });
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: orgIds } } });
  await db.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
  await db.plan.deleteMany({ where: { id: planId } });
});

describe("Phase 3 — WhatsApp Connection Center over HTTP", () => {
  it("owner sees the connection center pages", async () => {
    const a = await login(emails.a);
    for (const path of ["/dashboard/whatsapp", "/whatsapp/connect", "/whatsapp/connect?method=developer", "/whatsapp/accounts"]) {
      const res = await a.fetch(path);
      expect(res.status, path).toBe(200);
    }
    const html = await (await a.fetch("/dashboard/whatsapp")).text();
    expect(html).toContain("Connect with Meta");
    expect(html).toContain("I already use WhatsApp Business");
    expect(html).toContain("API / Developer setup");
    expect(html).toContain("Meta onboarding is not configured yet");
  });

  it("Meta Embedded Signup is refused while unconfigured; demo connection works", async () => {
    const a = await login(emails.a);
    expect((await a.fetch(`/api/organizations/${orgIds[0]}/whatsapp/connect/meta/start`, send("POST", { method: "embedded_signup" }))).status).toBe(503);
    const res = await a.fetch(`/api/organizations/${orgIds[0]}/whatsapp/connect/demo`, send("POST", { businessName: "E2E Demo Business" }));
    expect(res.status).toBe(201);
    const { account } = (await res.json()) as { account: { id: string; status: string; isDemo: boolean } };
    expect(account).toMatchObject({ status: "demo", isDemo: true });
    accountId = account.id;
    const page = await a.fetch(`/whatsapp/accounts/${accountId}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Demo data");
  });

  it("an agent can view but not disconnect", async () => {
    const agent = await login(emails.agent);
    expect((await agent.fetch("/whatsapp/accounts")).status).toBe(200);
    expect((await agent.fetch(`/api/organizations/${orgIds[0]}/whatsapp/accounts/${accountId}/disconnect`, send("POST", {}))).status).toBe(403);
  });

  it("another tenant can't see or touch the number", async () => {
    const b = await login(emails.b);
    expect((await b.fetch(`/api/organizations/${orgIds[0]}/whatsapp`)).status).toBe(403);
    expect((await b.fetch(`/api/organizations/${orgIds[1]}/whatsapp/accounts/${accountId}`)).status).toBe(404);
    expect((await b.fetch(`/api/organizations/${orgIds[1]}/whatsapp/accounts/${accountId}/disconnect`, send("POST", {}))).status).toBe(404);
    expect((await b.fetch(`/whatsapp/accounts/${accountId}`)).status).toBe(404);
  });

  it("owner disconnects", async () => {
    const a = await login(emails.a);
    const res = await a.fetch(`/api/organizations/${orgIds[0]}/whatsapp/accounts/${accountId}/disconnect`, send("POST", {}));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { account: { status: string } }).account.status).toBe("disconnected");
  });

  it("webhook endpoint rejects bad verify tokens and unsigned events", async () => {
    const c = new Client();
    expect((await c.fetch("/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=123")).status).toBe(403);
    const post = await c.fetch("/api/webhooks/meta", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ object: "whatsapp_business_account", entry: [] }) });
    expect(post.status).toBe(401);
  });
});
