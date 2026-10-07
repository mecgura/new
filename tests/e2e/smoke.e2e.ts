import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { Client } from "./http-client";

/**
 * Real HTTP smoke test: real Auth.js credential login, real cookies, real
 * proxy + route handlers. Requires a running server whose DATABASE_URL is the
 * same database this process uses.
 */
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const PASSWORD = `E2e-${randomBytes(6).toString("hex")}1`;
const tag = Date.now().toString(36);
const emails = {
  superAdmin: `e2e-super-${tag}@e2e.local`,
  ownerA: `e2e-owner-a-${tag}@e2e.local`,
  managerA: `e2e-manager-a-${tag}@e2e.local`,
  agentA: `e2e-agent-a-${tag}@e2e.local`,
  ownerB: `e2e-owner-b-${tag}@e2e.local`,
};
let orgA = "";
let orgB = "";

async function loggedIn(email: string) {
  const c = new Client();
  expect(await c.login(email, PASSWORD)).toBe(true);
  return c;
}

beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const mk = (email: string, role = "USER") => db.user.create({ data: { email, name: email.split("@")[0], passwordHash, role } });
  await mk(emails.superAdmin, "SUPER_ADMIN");
  const [oa, ma, aa, ob] = await Promise.all([mk(emails.ownerA), mk(emails.managerA), mk(emails.agentA), mk(emails.ownerB)]);
  orgA = (await db.organization.create({ data: { name: `E2E Org A ${tag}`, slug: `e2e-a-${tag}` } })).id;
  orgB = (await db.organization.create({ data: { name: `E2E Org B ${tag}`, slug: `e2e-b-${tag}` } })).id;
  await db.organizationMember.createMany({
    data: [
      { organizationId: orgA, userId: oa.id, role: "CLIENT_OWNER" },
      { organizationId: orgA, userId: ma.id, role: "MANAGER" },
      { organizationId: orgA, userId: aa.id, role: "AGENT" },
      { organizationId: orgB, userId: ob.id, role: "CLIENT_OWNER" },
    ],
  });
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.user.deleteMany({ where: { email: { in: Object.values(emails) } } });
});

describe("authentication", () => {
  it("wrong credentials do not create a session", async () => {
    const c = new Client();
    expect(await c.login(emails.ownerA, "wrong-password-1")).toBe(false);
    expect(await c.login("nobody@e2e.local", PASSWORD)).toBe(false);
    expect((await c.fetch("/api/me")).status).toBe(401);
  });

  it("login → dashboard → logout → protected page blocked", async () => {
    const c = await loggedIn(emails.ownerA);
    expect((await c.fetch("/dashboard")).status).toBe(200);
    const me = (await (await c.fetch("/api/me")).json()) as { user: { email: string } };
    expect(me.user.email).toBe(emails.ownerA);

    await c.logout();
    const after = await c.fetch("/dashboard");
    expect(after.status).toBe(307);
    expect(after.headers.get("location")).toContain("/login");
    expect((await c.fetch("/api/me")).status).toBe(401);
  });

  it("a garbage session cookie is treated as signed out", async () => {
    const c = new Client();
    c.jar.set("authjs.session-token", "not-a-real-token");
    expect((await c.fetch("/dashboard")).headers.get("location")).toContain("/login");
    expect((await c.fetch("/api/me")).status).toBe(401);
  });

  it("'sign out of all devices' revokes a still-held cookie", async () => {
    const c = await loggedIn(emails.managerA);
    const stolen = new Client();
    stolen.jar = new Map(c.jar);
    expect((await stolen.fetch("/api/me")).status).toBe(200);
    expect((await c.fetch("/api/me/sessions", { method: "DELETE" })).status).toBe(200);
    expect((await stolen.fetch("/api/me")).status).toBe(401);
  });
});

describe("role authorization over HTTP", () => {
  it("SUPER_ADMIN → /admin allowed", async () => {
    const c = await loggedIn(emails.superAdmin);
    expect((await c.fetch("/admin")).status).toBe(200);
    expect((await c.fetch("/admin/clients")).status).toBe(200);
    expect((await c.fetch("/api/admin/organizations")).status).toBe(200);
  });

  it.each([
    ["CLIENT_OWNER", emails.ownerA],
    ["MANAGER", emails.managerA],
    ["AGENT", emails.agentA],
  ])("%s → /admin denied (page redirect + API 403)", async (_role, email) => {
    const c = await loggedIn(email);
    const page = await c.fetch("/admin");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/dashboard?denied=admin");
    expect((await c.fetch("/api/admin/organizations")).status).toBe(403);
    expect((await c.fetch("/api/admin/users")).status).toBe(403);
    expect((await c.fetch("/api/admin/plans")).status).toBe(403);
  });

  it("signed out → admin API 401", async () => {
    expect((await new Client().fetch("/api/admin/organizations")).status).toBe(401);
  });
});

describe("tenant isolation over HTTP", () => {
  it("User A → Org A allowed, Org B denied", async () => {
    const a = await loggedIn(emails.ownerA);
    expect((await a.fetch(`/api/organizations/${orgA}`)).status).toBe(200);
    expect((await a.fetch(`/api/organizations/${orgB}`)).status).toBe(403);
    expect((await a.fetch(`/api/organizations/${orgB}/members`)).status).toBe(403);
    const patch = await a.fetch(`/api/organizations/${orgB}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ name: "Hacked" }),
    });
    expect(patch.status).toBe(403);
  });

  it("User B → Org B allowed, Org A denied", async () => {
    const b = await loggedIn(emails.ownerB);
    expect((await b.fetch(`/api/organizations/${orgB}`)).status).toBe(200);
    expect((await b.fetch(`/api/organizations/${orgA}`)).status).toBe(403);
    expect((await b.fetch(`/api/organizations/${orgA}/audit-logs`)).status).toBe(403);
  });

  it("cross-origin writes are blocked", async () => {
    const a = await loggedIn(emails.ownerA);
    const res = await a.fetch(`/api/organizations/${orgA}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ name: "CSRF" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("security headers", () => {
  it("are present", async () => {
    const res = await new Client().fetch("/login");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });
});
