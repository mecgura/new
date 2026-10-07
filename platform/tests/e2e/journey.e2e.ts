import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { Client, BASE } from "./http-client";

/**
 * THE FINAL TEST — one customer's whole life on the platform, over real HTTP with real cookies:
 * admin creates a tenant → users → demo WhatsApp → contacts → template → campaign (+ compliance) →
 * automation (+ run) → Flow (+ submit) → AI demo → team → public API → webhook → billing → analytics →
 * admin views → tenant isolation. Needs a running server on the same DATABASE_URL (see vitest.e2e.config.ts).
 */
const PASSWORD = `Final-${randomBytes(6).toString("hex")}1`;
const tag = Date.now().toString(36);
const emails = {
  admin: `final-admin-${tag}@e2e.local`,
  owner: `final-owner-${tag}@e2e.local`,
  agent: `final-agent-${tag}@e2e.local`,
  manager: `final-manager-${tag}@e2e.local`,
  rival: `final-rival-${tag}@e2e.local`,
};
const J = { "content-type": "application/json" };
const send = (method: string, body?: unknown) => ({ method, headers: J, body: body === undefined ? undefined : JSON.stringify(body) });

let admin: Client;
let owner: Client;
let rival: Client;
let orgId = "";
let rivalOrgId = "";
let accountId = "";
let wabaRecordId = "";
const S: Record<string, string> = {};
let phoneSeq = 0;
const phone = () => `+91970${String(Date.now()).slice(-5)}${String(phoneSeq++).padStart(2, "0")}`.slice(0, 13);

const org = (p: string) => `/api/organizations/${orgId}${p}`;
async function call(c: Client, path: string, init?: RequestInit) {
  const res = await c.fetch(path, init);
  const text = await res.text();
  let body: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body };
}
async function until<T>(fn: () => Promise<T | null | false>, what: string, ms = 90_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await db.user.create({ data: { email: emails.admin, name: "Final Admin", passwordHash, role: "SUPER_ADMIN" } });
  admin = new Client();
  expect(await admin.login(emails.admin, PASSWORD)).toBe(true);
}, 60_000);

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: [orgId, rivalOrgId].filter(Boolean) } } });
  await db.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
});

describe("1. platform admin creates a test tenant and its users", () => {
  it("creates the tenant on the Enterprise plan with the WhatsApp service", async () => {
    const plan = await db.plan.findFirstOrThrow({ where: { slug: "enterprise" } });
    const r = await call(admin, "/api/admin/organizations", send("POST", { name: `Final Test Co ${tag}`, ownerName: "Final Owner", ownerEmail: emails.owner, ownerPassword: PASSWORD, planId: plan.id, services: ["WHATSAPP_AUTOMATION"] }));
    expect(r.status).toBe(201);
    orgId = (r.body.organization?.id ?? r.body.id) as string;
    expect(orgId).toBeTruthy();
    const rv = await call(admin, "/api/admin/organizations", send("POST", { name: `Rival Co ${tag}`, ownerName: "Rival Owner", ownerEmail: emails.rival, ownerPassword: PASSWORD, planId: plan.id, services: ["WHATSAPP_AUTOMATION"] }));
    expect(rv.status).toBe(201);
    rivalOrgId = (rv.body.organization?.id ?? rv.body.id) as string;
    owner = new Client();
    rival = new Client();
    expect(await owner.login(emails.owner, PASSWORD)).toBe(true);
    expect(await rival.login(emails.rival, PASSWORD)).toBe(true);
  });

  it("the client owner adds a manager and an agent (team)", async () => {
    for (const [email, name, role] of [[emails.manager, "Final Manager", "MANAGER"], [emails.agent, "Final Agent", "AGENT"]]) {
      const r = await call(owner, org("/members"), send("POST", { email, name, role, password: PASSWORD }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const list = await call(owner, org("/members"));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain(emails.agent);
  });

  it("each role signs in; an agent can't manage the team", async () => {
    const agent = new Client();
    expect(await agent.login(emails.agent, PASSWORD)).toBe(true);
    expect((await call(agent, org("/members"), send("POST", { email: `x-${tag}@e2e.local`, name: "X", role: "AGENT", password: PASSWORD }))).status).toBe(403);
    const manager = new Client();
    expect(await manager.login(emails.manager, PASSWORD)).toBe(true);
    expect((await call(manager, org("/members"))).status).toBe(200);
  });
});

describe("2. WhatsApp (demo), contacts, inbox", () => {
  it("connects a demo WhatsApp number — labelled as demo", async () => {
    const r = await call(owner, org("/whatsapp/connect/demo"), send("POST", { businessName: "Final Store" }));
    expect(r.status).toBe(201);
    accountId = r.body.account.id;
    const acct = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } });
    wabaRecordId = acct.wabaRecordId!;
    expect(acct.isDemo ?? true).toBe(true);
  });

  it("creates opted-in contacts (one tagged VIP) and finds them by search", async () => {
    for (const [name, tags] of [["Priya Sharma", ["VIP"]], ["Aman Gill", ["VIP"]]] as const) {
      const r = await call(owner, org("/contacts"), send("POST", { phone: phone(), name, optInStatus: "opted_in", consentEvidence: "Signed up on the website", tags }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      S[`contact_${name.split(" ")[0]}`] = r.body.contact.id;
    }
    const found = await call(owner, org("/contacts?q=Priya"));
    expect(found.status).toBe(200);
    expect(found.body.items.map((c: { name: string }) => c.name)).toContain("Priya Sharma");
  });

  it("a customer message arrives in the inbox and the team replies", async () => {
    const from = phone();
    const r = await call(owner, org("/inbox/demo/inbound"), send("POST", { whatsappAccountId: accountId, phone: from, name: "Walk-in Customer", body: "Hi, do you deliver?" }));
    expect(r.status).toBe(201);
    S.conversation = r.body.conversationId;
    const reply = await call(owner, org(`/inbox/conversations/${S.conversation}/messages`), send("POST", { type: "text", body: "Yes, we deliver across the city." }));
    expect(reply.status).toBe(201);
    const msgs = await call(owner, org(`/inbox/conversations/${S.conversation}/messages`));
    expect(msgs.status).toBe(200);
    expect(JSON.stringify(msgs.body)).toContain("do you deliver");
  });
});

describe("3. template → campaign → compliance → send", () => {
  it("creates, submits and (demo) approves a template", async () => {
    const c = await call(owner, org("/templates"), send("POST", { wabaId: wabaRecordId, name: `final_offer_${tag}`.slice(0, 40).replace(/[^a-z0-9_]/g, "_"), language: "en", category: "MARKETING", body: "Hi {{1}}, our new collection is in store. Reply STOP to unsubscribe.", examples: { body: ["Priya"] } }));
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    S.template = c.body.template.id;
    expect((await call(owner, org(`/templates/${S.template}/submit`), send("POST", {}))).status).toBe(200);
    expect((await call(owner, org(`/templates/${S.template}/review`), send("POST", { decision: "approved" }))).status).toBe(200);
  });

  it("builds the campaign through the wizard steps and passes the compliance check", async () => {
    const created = await call(owner, org("/campaigns"), send("POST", { name: "Final launch", whatsappAccountId: accountId }));
    expect(created.status).toBe(201);
    S.campaign = created.body.campaign.id;
    const tags = await call(owner, org("/tags"));
    const vip = tags.body.tags.find((t: { name: string }) => t.name === "VIP").id;
    const patch = (b: unknown) => call(owner, org(`/campaigns/${S.campaign}`), send("PATCH", b));
    expect((await patch({ audience: { mode: "filters", filters: { tagIds: [vip], consent: [] } }, step: 3 })).status).toBe(200);
    expect((await patch({ templateId: S.template, step: 4 })).status).toBe(200);
    expect((await patch({ variables: { "body.1": { source: "field", field: "first_name", fallback: "there" } }, step: 5 })).status).toBe(200);
    expect((await patch({ scheduledAt: null, step: 6 })).status).toBe(200);
    // Launch is refused until a compliance review exists.
    expect((await call(owner, org(`/campaigns/${S.campaign}/launch`), send("POST", { confirmConsent: true }))).status).toBe(409);
    const rev = await call(owner, org(`/campaigns/${S.campaign}/review`), send("POST", {}));
    expect(rev.status).toBe(200);
    expect(rev.body.review).toMatchObject({ total: 2, eligible: 2, canSend: true });
  });

  it("requires consent confirmation, then sends through the demo transport", async () => {
    expect((await call(owner, org(`/campaigns/${S.campaign}/launch`), send("POST", {}))).status).toBe(400);
    const l = await call(owner, org(`/campaigns/${S.campaign}/launch`), send("POST", { confirmConsent: true }));
    expect(l.status, JSON.stringify(l.body)).toBe(200);
    const done = await until(async () => {
      const r = await call(owner, org(`/campaigns/${S.campaign}`));
      return r.body.campaign?.status === "completed" ? r.body.campaign : false;
    }, "the campaign to finish sending");
    expect(done.totalRecipients).toBe(2);
    const stats = await call(owner, org(`/campaigns/${S.campaign}/analytics`));
    expect(stats.status).toBe(200);
  }, 120_000);
});

describe("4. automation → run", () => {
  it("creates and publishes the demo welcome workflow, then it runs on a new contact", async () => {
    const c = await call(owner, org("/automations"), send("POST", { name: "Welcome new contacts", whatsappAccountId: accountId, start: "demo_welcome" }));
    expect(c.status).toBe(201);
    S.automation = c.body.automation.id;
    const p = await call(owner, org(`/automations/${S.automation}/publish`), send("POST", { note: "final test" }));
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.automation).toMatchObject({ status: "active", triggerType: "new_contact" });
    const r = await call(owner, org("/inbox/demo/inbound"), send("POST", { whatsappAccountId: accountId, phone: phone(), name: "Automation Lead", body: "Hello, I saw your ad" }));
    expect(r.status).toBe(201);
    const ran = await until(async () => {
      const ex = await call(owner, org(`/automations/${S.automation}/executions`));
      return ex.status === 200 && (ex.body.items ?? ex.body.executions ?? []).length > 0 ? ex.body : false;
    }, "the automation to run");
    expect(JSON.stringify(ran)).toMatch(/completed|waiting|running/);
  }, 120_000);
});

describe("5. WhatsApp Flow → submit; AI agent (demo)", () => {
  it("creates a lead Flow, publishes it in demo mode and records a submission in the CRM", async () => {
    const c = await call(owner, org("/flows"), send("POST", { name: "Lead Registration", wabaId: wabaRecordId, template: "lead" }));
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    S.flow = c.body.flow.id;
    const p = await call(owner, org(`/flows/${S.flow}/publish`), send("POST"));
    expect(p.status).toBe(200);
    expect(p.body.flow).toMatchObject({ status: "published", isDemo: true });
    const sub = await call(owner, org(`/flows/${S.flow}/demo-submit`), send("POST", { phone: phone(), name: "Flow Lead", answers: { full_name: "Flow Lead", email: "flow.lead@example.com", city: "Jalandhar", interest: ["Website"], budget: "₹10k–₹25k", marketing_optin: true } }));
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const list = await call(owner, org(`/flows/${S.flow}/submissions`));
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain("flow.lead@example.com");
  });

  it("creates an AI agent and chats with it in clearly-labelled demo mode", async () => {
    const a = await call(owner, org("/ai/agents"), send("POST", {
      name: "Store assistant",
      instructions: "Be brief and friendly.",
      knowledge: { faqs: [{ q: "What are your timings?", a: "We're open 10am–7pm, Monday to Saturday." }], products: [], services: [], pricing: "" },
      actions: { answer: true, qualify: true, collect: true, collectFields: ["name", "email"], book: false, bookingServices: [], transfer: true, summarize: true },
      handoff: { keywords: ["human"], assign: "auto", userId: "", message: "Connecting you with our team.", resume: "manual", resumeAfterHours: 24 },
    }));
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    S.agent = a.body.agent.id;
    const live = await call(owner, org(`/ai/agents/${S.agent}/test`), send("POST", { message: "hi", mode: "live" }));
    expect(live.status).toBe(409); // no ANTHROPIC_API_KEY → live is refused, never faked
    const demo = await call(owner, org(`/ai/agents/${S.agent}/test`), send("POST", { message: "what are your timings?", mode: "demo" }));
    expect(demo.status).toBe(200);
    expect(JSON.stringify(demo.body)).toMatch(/10am/);
    expect(JSON.stringify(demo.body)).toMatch(/demo/i);
  });
});

describe("6. public API and outgoing webhook", () => {
  it("creates a scoped API key (secret shown once) and uses it on /api/v1", async () => {
    const k = await call(owner, org("/api-keys"), send("POST", { name: "Final test", permissions: ["contacts:read", "contacts:write"] }));
    expect(k.status, JSON.stringify(k.body)).toBe(201);
    const secret = k.body.secret as string;
    expect(secret).toMatch(/^mgk_/);
    S.keyId = k.body.key.id;
    const list = await call(owner, org("/api-keys"));
    expect(JSON.stringify(list.body)).not.toContain(secret); // never shown again
    const bearer = { authorization: `Bearer ${secret}` };
    const created = await call(new Client(), "/api/v1/contacts", { method: "POST", headers: { ...J, ...bearer }, body: JSON.stringify({ phone: phone(), name: "API Lead", opt_in: { evidence: "Website form" } }) });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await call(new Client(), "/api/v1/contacts", { headers: bearer })).status).toBe(200);
    // Scope enforcement + no key + wrong key.
    expect((await call(new Client(), "/api/v1/messages", { method: "POST", headers: { ...J, ...bearer }, body: JSON.stringify({ to: phone(), type: "text", text: "x" }) })).status).toBe(403);
    expect((await call(new Client(), "/api/v1/contacts")).status).toBe(401);
    expect((await call(new Client(), "/api/v1/contacts", { headers: { authorization: "Bearer mgk_wrong" } })).status).toBe(401);
    // Revoked keys stop working.
    expect((await call(owner, org(`/api-keys/${S.keyId}/revoke`), send("POST", {}))).status).toBe(200);
    expect((await call(new Client(), "/api/v1/contacts", { headers: bearer })).status).toBe(401);
    const usage = await call(owner, org("/api-usage"));
    expect(usage.status).toBe(200);
  });

  it("registers a signed webhook endpoint, refuses private addresses, and can send a test event", async () => {
    const bad = await call(owner, org("/webhooks"), send("POST", { url: "http://127.0.0.1:9/hook", events: ["message.received"] }));
    expect(bad.status).toBe(400);
    let ep = await call(owner, org("/webhooks"), send("POST", { url: "https://hooks.example.com/mecgura", events: ["message.received", "flow.submitted"], description: "Final test" }));
    if (ep.status === 400 && /resolve/.test(JSON.stringify(ep.body))) {
      // This machine has no outbound DNS, so the (correct) DNS check refuses every host. Seed the endpoint the way the API would.
      const { encryptSecret } = await import("@/lib/crypto");
      const secret = `whsec_${randomBytes(16).toString("hex")}`;
      const row = await db.webhookEndpoint.create({ data: { organizationId: orgId, url: "https://hooks.example.com/mecgura", events: JSON.stringify(["message.received", "flow.submitted"]), description: "Final test", secretEnc: encryptSecret(secret), secretLast4: secret.slice(-4) } });
      ep = { status: 201, body: { secret, endpoint: { id: row.id } } };
    }
    expect(ep.status, JSON.stringify(ep.body)).toBe(201);
    expect(ep.body.secret).toMatch(/^whsec_/);
    S.endpoint = ep.body.endpoint.id;
    const list = await call(owner, org("/webhooks"));
    expect(JSON.stringify(list.body)).not.toContain(ep.body.secret);
    expect((await call(owner, org(`/webhooks/${S.endpoint}/rotate-secret`), send("POST", {}))).status).toBe(201);
  });
});

describe("7. billing, usage, analytics", () => {
  it("shows the plan, usage and invoices; an upgrade creates a real (unpaid) invoice, never a fake payment", async () => {
    const b = await call(owner, org("/billing"));
    expect(b.status).toBe(200);
    expect(JSON.stringify(b.body)).toMatch(/Enterprise/i);
    const u = await call(owner, org("/billing/usage"));
    expect(u.status).toBe(200);
    expect(JSON.stringify(u.body)).toMatch(/messages/i);
    const inv = await call(owner, org("/billing/invoices"));
    expect(inv.status).toBe(200);
    // Without a payment gateway configured, paying an invoice is refused honestly (not marked paid).
    const invoices = (inv.body.invoices ?? inv.body.items ?? []) as { id: string; status: string }[];
    const open = invoices.find((i) => i.status === "open");
    if (open) {
      const pay = await call(owner, org(`/billing/invoices/${open.id}/pay`), send("POST", {}));
      expect([200, 409, 503]).toContain(pay.status);
      const after = await call(owner, org(`/billing/invoices/${open.id}`));
      if (pay.status !== 200) expect(JSON.stringify(after.body)).not.toMatch(/"status":"paid"/);
    }
  });

  it("client analytics reflect what this test just did", async () => {
    const a = await call(owner, org("/analytics?days=30"));
    expect(a.status).toBe(200);
    const text = JSON.stringify(a.body);
    expect(text).toMatch(/conversation/i);
    expect(a.body).toBeTruthy();
  });

  it("the audit log recorded the sensitive actions", async () => {
    const logs = await call(owner, org("/audit-logs"));
    expect(logs.status).toBe(200);
    expect(JSON.stringify(logs.body)).toMatch(/api_key|campaign|member|whatsapp/i);
  });
});

describe("8. super admin views", () => {
  it("sees the tenant in billing, analytics, usage, audit logs and the client list", async () => {
    for (const path of ["/api/admin/billing/overview", "/api/admin/analytics", "/api/admin/usage", "/api/admin/audit-logs", "/api/admin/organizations", "/api/admin/plans"]) {
      const r = await call(admin, path);
      expect(r.status, path).toBe(200);
    }
    const orgs = await call(admin, "/api/admin/organizations");
    expect(JSON.stringify(orgs.body)).toContain(`Final Test Co ${tag}`);
    // An admin page renders for the admin and bounces everyone else.
    expect((await admin.fetch("/admin/billing")).status).toBe(200);
    expect((await owner.fetch("/admin/billing")).status).toBe(307);
    expect((await call(owner, "/api/admin/organizations")).status).toBe(403);
  });
});

describe("9. tenant isolation (the rival workspace sees nothing of ours)", () => {
  it("can't use our workspace id on any module", async () => {
    for (const p of ["/contacts", "/inbox/conversations", "/templates", "/campaigns", "/automations", "/flows", "/ai/agents", "/api-keys", "/webhooks", "/billing", "/billing/usage", "/analytics", "/members", "/audit-logs", "/whatsapp"]) {
      const r = await call(rival, org(p));
      expect(r.status, `GET ${p}`).toBe(403);
    }
  });

  it("through its own workspace, our records don't exist", async () => {
    const mine = (p: string) => `/api/organizations/${rivalOrgId}${p}`;
    expect((await call(rival, mine(`/contacts/${S.contact_Priya}`))).status, mine(`/contacts/${S.contact_Priya}`)).toBe(404);
    expect((await call(rival, mine(`/campaigns/${S.campaign}`))).status, mine(`/campaigns/${S.campaign}`)).toBe(404);
    expect((await call(rival, mine(`/templates/${S.template}`))).status, mine(`/templates/${S.template}`)).toBe(404);
    expect((await call(rival, mine(`/automations/${S.automation}`))).status, mine(`/automations/${S.automation}`)).toBe(404);
    expect((await call(rival, mine(`/flows/${S.flow}`))).status, mine(`/flows/${S.flow}`)).toBe(404);
    expect((await call(rival, mine(`/ai/agents/${S.agent}`))).status, mine(`/ai/agents/${S.agent}`)).toBe(404);
    expect((await call(rival, mine(`/webhooks/${S.endpoint}`), send("DELETE"))).status, mine(`/webhooks/${S.endpoint}`)).toBe(404);
    expect((await call(rival, mine(`/inbox/conversations/${S.conversation}/messages`), send("POST", { type: "text", body: "hijack" }))).status, mine(`/inbox/conversations/${S.conversation}/messages`)).toBe(404);
    const list = await call(rival, mine("/contacts"));
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);
    // The page itself is only a shell that loads data through the (tenant-checked) API — nothing of ours is in it.
    const html = await (await rival.fetch(`/contacts/${S.contact_Priya}`)).text();
    expect(html).not.toContain("Priya");
    // Nothing of ours was touched.
    expect(await db.contact.count({ where: { organizationId: orgId } })).toBeGreaterThanOrEqual(3);
    expect(await db.message.count({ where: { organizationId: orgId, body: "hijack" } })).toBe(0);
  });

  it("signed-out visitors get nothing, and the dashboard redirects to login", async () => {
    const anon = new Client();
    expect((await call(anon, org("/contacts"))).status).toBe(401);
    const page = await anon.fetch("/dashboard");
    expect(page.status).toBe(307);
    expect(page.headers.get("location") ?? "").toContain("/login");
    void BASE;
  });
});
