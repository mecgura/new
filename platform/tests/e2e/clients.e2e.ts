import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { BASE, Client } from "./http-client";

/** Phase 2 end-to-end over real HTTP: admin onboards a client, the client logs in, admin manages it. */
const tag = Date.now().toString(36);
const ADMIN_EMAIL = `e2e-p2-admin-${tag}@e2e.local`;
const ADMIN_PASSWORD = `Adm-${randomBytes(6).toString("hex")}1`;
const OWNER_EMAIL = `e2e-p2-owner-${tag}@e2e.local`;
const OWNER_PASSWORD = `Own-${randomBytes(6).toString("hex")}1`;
let planA = "";
let planB = "";
let orgId = "";
let otherOrgId = "";

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify(body) });
const send = (method: string, body?: unknown) => ({ method, headers: { "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });

async function login(email: string, password: string) {
  const c = new Client();
  expect(await c.login(email, password)).toBe(true);
  return c;
}

beforeAll(async () => {
  await db.user.create({ data: { email: ADMIN_EMAIL, name: "E2E Admin", role: "SUPER_ADMIN", passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10) } });
  planA = (await db.plan.create({ data: { name: `E2E Starter ${tag}`, slug: `e2e-starter-${tag}`, priceMonthly: 199900, maxUsers: 3, maxWhatsAppNumbers: 1 } })).id;
  planB = (await db.plan.create({ data: { name: `E2E Growth ${tag}`, slug: `e2e-growth-${tag}`, priceMonthly: 499900, maxUsers: 10, maxWhatsAppNumbers: 2 } })).id;
  otherOrgId = (await db.organization.create({ data: { name: `E2E Other ${tag}`, slug: `e2e-other-${tag}` } })).id;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId].filter(Boolean) } } });
  await db.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, OWNER_EMAIL] } } });
  await db.plan.deleteMany({ where: { id: { in: [planA, planB] } } });
});

describe("Phase 2 — client management over HTTP", () => {
  it("admin logs in and creates a client", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect((await admin.fetch("/admin")).status).toBe(200);
    expect((await admin.fetch("/admin/clients")).status).toBe(200);
    const res = await admin.fetch(
      "/api/admin/organizations",
      json({ name: `E2E Client ${tag}`, ownerName: "E2E Owner", ownerEmail: OWNER_EMAIL, ownerPassword: OWNER_PASSWORD, mobile: "+91 98765 43210", planId: planA, services: ["WHATSAPP_AUTOMATION", "AI_ASSISTANT"] })
    );
    expect(res.status).toBe(201);
    orgId = ((await res.json()) as { organization: { id: string } }).organization.id;
    expect((await admin.fetch(`/admin/clients/${orgId}`)).status).toBe(200);
    const detail = (await (await admin.fetch(`/api/admin/organizations/${orgId}`)).json()) as { plan: { id: string }; organization: { services: { service: string; enabled: boolean }[] } };
    expect(detail.plan.id).toBe(planA);
    expect(detail.organization.services.filter((s) => s.enabled).map((s) => s.service).sort()).toEqual(["AI_ASSISTANT", "WHATSAPP_AUTOMATION"]);
  });

  it("the new client owner can log in and use their dashboard", async () => {
    const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    expect((await owner.fetch("/dashboard")).status).toBe(200);
    const me = (await (await owner.fetch("/api/me")).json()) as { activeOrganizationId: string; user: { memberships: { role: string }[] } };
    expect(me.activeOrganizationId).toBe(orgId);
    expect(me.user.memberships[0].role).toBe("CLIENT_OWNER");
    expect((await owner.fetch(`/api/organizations/${orgId}`)).status).toBe(200);
  });

  it("the client owner has no admin privileges and can't reach other tenants", async () => {
    const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const page = await owner.fetch("/admin/clients");
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/dashboard?denied=admin");
    for (const path of ["/api/admin/organizations", `/api/admin/organizations/${orgId}`, "/api/admin/plans", "/api/admin/usage", "/api/admin/whatsapp-accounts"]) {
      expect((await owner.fetch(path)).status).toBe(403);
    }
    expect((await owner.fetch(`/api/admin/organizations/${orgId}/plan`, send("PUT", { planId: planB }))).status).toBe(403);
    expect((await owner.fetch(`/api/admin/organizations/${orgId}/services`, send("PUT", { services: { HRMS: true } }))).status).toBe(403);
    expect((await owner.fetch(`/api/organizations/${otherOrgId}`)).status).toBe(403);
  });

  it("suspend blocks the client; activate restores access", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    expect((await admin.fetch(`/api/admin/organizations/${orgId}`, send("PATCH", { status: "suspended" }))).status).toBe(200);
    expect((await owner.fetch(`/api/organizations/${orgId}`)).status).toBe(403);
    const dash = await owner.fetch("/dashboard");
    expect(dash.status).toBe(200);
    expect(await dash.text()).toContain("is suspended");

    expect((await admin.fetch(`/api/admin/organizations/${orgId}`, send("PATCH", { status: "active" }))).status).toBe(200);
    expect((await owner.fetch(`/api/organizations/${orgId}`)).status).toBe(200);
  });

  it("plan assignment changes the client's plan and is audit-logged", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    expect((await admin.fetch(`/api/admin/organizations/${orgId}/plan`, send("PUT", { planId: planB }))).status).toBe(200);
    const detail = (await (await admin.fetch(`/api/admin/organizations/${orgId}`)).json()) as { plan: { id: string } };
    expect(detail.plan.id).toBe(planB);
    const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    expect(await (await owner.fetch("/dashboard")).text()).toContain(`E2E Growth ${tag}`);
    const logs = (await (await admin.fetch(`/api/admin/audit-logs?action=plan.changed&pageSize=50`)).json()) as { items: { organization: { id: string } | null }[] };
    expect(logs.items.filter((l) => l.organization?.id === orgId).length).toBe(2);
  });

  it("reset access issues a new password and kills the old session", async () => {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const oldOwner = await login(OWNER_EMAIL, OWNER_PASSWORD);
    const r = (await (await admin.fetch(`/api/admin/organizations/${orgId}/reset-access`, json({}))).json()) as { password: string };
    expect((await oldOwner.fetch("/api/me")).status).toBe(401);
    expect(await new Client().login(OWNER_EMAIL, OWNER_PASSWORD)).toBe(false);
    expect(await new Client().login(OWNER_EMAIL, r.password)).toBe(true);
  });
});
