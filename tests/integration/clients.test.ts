import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as clients from "@/app/api/admin/organizations/route";
import * as client from "@/app/api/admin/organizations/[id]/route";
import * as clientServices from "@/app/api/admin/organizations/[id]/services/route";
import * as clientPlan from "@/app/api/admin/organizations/[id]/plan/route";
import * as resetAccess from "@/app/api/admin/organizations/[id]/reset-access/route";
import * as clientNumbers from "@/app/api/admin/organizations/[id]/whatsapp-accounts/route";
import * as numbers from "@/app/api/admin/whatsapp-accounts/route";
import * as number from "@/app/api/admin/whatsapp-accounts/[id]/route";
import * as plans from "@/app/api/admin/plans/route";
import * as planRoute from "@/app/api/admin/plans/[id]/route";
import * as usage from "@/app/api/admin/usage/route";
import * as adminUser from "@/app/api/admin/users/[id]/route";
import * as orgRoute from "@/app/api/organizations/[orgId]/route";
import * as membersRoute from "@/app/api/organizations/[orgId]/members/route";
import * as meRoute from "@/app/api/me/route";
import { incrementUsage, getUsageSummary } from "@/lib/services/usage";
import { mrrAt } from "@/lib/services/clients";

type U = Awaited<ReturnType<typeof makeUser>>;
let admin: U;
let starter: { id: string; slug: string }, growth: { id: string; slug: string };

beforeAll(async () => {
  admin = await makeUser({ role: "SUPER_ADMIN", name: "Platform Admin" });
  starter = await makePlan({ name: "Starter T", priceMonthly: 199900, maxUsers: 2, maxWhatsAppNumbers: 1 });
  growth = await makePlan({ name: "Growth T", priceMonthly: 499900, maxUsers: 10, maxWhatsAppNumbers: 3 });
});

const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function createClient(overrides: Record<string, unknown> = {}) {
  actAs(admin);
  const email = `owner-${uniq()}@client.local`;
  const res = await json(
    await clients.POST(
      req("/api/admin/organizations", {
        method: "POST",
        body: { name: `Client ${uniq()}`, ownerName: "Client Owner", ownerEmail: email, ownerPassword: "Passw0rd!", mobile: "+91 98765 43210", planId: starter.id, services: ["WHATSAPP_AUTOMATION", "CRM"], ...overrides },
      })
    )
  );
  return { ...res, email, orgId: (res.body.organization as { id: string } | undefined)?.id ?? "" };
}

const asOwnerOf = async (orgId: string) => {
  const m = await db.organizationMember.findFirstOrThrow({ where: { organizationId: orgId, role: "CLIENT_OWNER" }, include: { user: true } });
  return m.user;
};

describe("create client", () => {
  it("creates organization, owner, membership, plan, default settings, services and audit logs", async () => {
    const { status, orgId, email } = await createClient();
    expect(status).toBe(201);
    const org = await db.organization.findUniqueOrThrow({
      where: { id: orgId },
      include: { members: { include: { user: true } }, subscriptions: true, settings: true, services: true },
    });
    expect(org.status).toBe("active");
    expect(org.contactPhone).toBe("+91 98765 43210");
    expect(org.members).toHaveLength(1);
    expect(org.members[0]).toMatchObject({ role: "CLIENT_OWNER", user: { email, role: "USER" } });
    expect(await bcrypt.compare("Passw0rd!", org.members[0].user.passwordHash)).toBe(true);
    expect(org.subscriptions).toEqual([expect.objectContaining({ planId: starter.id, status: "active", priceMonthly: 199900 })]);
    expect(org.settings).toMatchObject({ timezone: "Asia/Kolkata", currency: "INR" });
    expect(org.services).toHaveLength(6);
    expect(org.services.filter((s) => s.enabled).map((s) => s.service).sort()).toEqual(["CRM", "WHATSAPP_AUTOMATION"]);
    const actions = (await db.auditLog.findMany({ where: { organizationId: orgId } })).map((a) => a.action).sort();
    expect(actions).toEqual(["client.created", "plan.changed", "service.enabled", "service.enabled", "user.created"]);
  });

  it("validates input (400 with field errors) and rejects inactive plans", async () => {
    actAs(admin);
    const bad = await json(await clients.POST(req("/x", { method: "POST", body: { name: "A", ownerEmail: "nope", ownerPassword: "weak", services: ["NOPE"] } })));
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.details as object)).toEqual(expect.arrayContaining(["name", "ownerName", "ownerEmail", "ownerPassword", "planId"]));
    const inactive = await makePlan({ isActive: false });
    expect((await createClient({ planId: inactive.id })).status).toBe(400);
  });

  it("can be created suspended", async () => {
    const { orgId } = await createClient({ status: "suspended" });
    expect((await db.organization.findUniqueOrThrow({ where: { id: orgId } })).status).toBe("suspended");
  });

  it("lists clients with owner, plan, numbers and usage; filters by status and plan", async () => {
    const { orgId } = await createClient();
    actAs(admin);
    const all = await json(await clients.GET(req("/api/admin/organizations?pageSize=100")));
    const row = (all.body.items as { id: string; owner: { email: string }; plan: { id: string }; seats: number; whatsappNumbers: number }[]).find((r) => r.id === orgId)!;
    expect(row.plan.id).toBe(starter.id);
    expect(row.seats).toBe(1);
    expect(row.whatsappNumbers).toBe(0);
    const suspended = await json(await clients.GET(req("/api/admin/organizations?status=suspended&pageSize=100")));
    expect((suspended.body.items as { status: string }[]).every((r) => r.status === "suspended")).toBe(true);
    const byPlan = await json(await clients.GET(req(`/api/admin/organizations?planId=${growth.id}&pageSize=100`)));
    expect((byPlan.body.items as { plan: { id: string } }[]).every((r) => r.plan.id === growth.id)).toBe(true);
  });
});

describe("client lifecycle", () => {
  it("edit → audit client.updated", async () => {
    const { orgId } = await createClient();
    actAs(admin);
    const res = await client.PATCH(req("/x", { method: "PATCH", body: { name: "Renamed Co", contactPhone: "+91 90000 00000" } }), params({ id: orgId }));
    expect(res.status).toBe(200);
    expect((await db.organization.findUniqueOrThrow({ where: { id: orgId } })).name).toBe("Renamed Co");
    expect(await db.auditLog.count({ where: { organizationId: orgId, action: "client.updated" } })).toBe(1);
  });

  it("suspend blocks the client's users; activate restores them", async () => {
    const { orgId } = await createClient();
    const owner = await asOwnerOf(orgId);
    actAs(owner);
    expect((await orgRoute.GET(req("/x"), params({ orgId }))).status).toBe(200);

    actAs(admin);
    expect((await client.PATCH(req("/x", { method: "PATCH", body: { status: "suspended" } }), params({ id: orgId }))).status).toBe(200);
    actAs(owner);
    expect((await orgRoute.GET(req("/x"), params({ orgId }))).status).toBe(403);
    const me = await json(await meRoute.GET(req("/api/me"), {}));
    expect(me.body.activeOrganizationId).toBeNull();

    actAs(admin);
    expect((await client.PATCH(req("/x", { method: "PATCH", body: { status: "active" } }), params({ id: orgId }))).status).toBe(200);
    actAs(owner);
    expect((await orgRoute.GET(req("/x"), params({ orgId }))).status).toBe(200);

    const actions = (await db.auditLog.findMany({ where: { organizationId: orgId, action: { startsWith: "client." } }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["client.created", "client.suspended", "client.activated"]);
  });

  it("plan assignment keeps history, logs plan.changed and changes MRR", async () => {
    const { orgId } = await createClient();
    const before = await mrrAt(new Date());
    actAs(admin);
    expect((await clientPlan.PUT(req("/x", { method: "PUT", body: { planId: growth.id } }), params({ id: orgId }))).status).toBe(200);
    const subs = await db.subscription.findMany({ where: { organizationId: orgId }, orderBy: { startedAt: "asc" } });
    expect(subs.map((s) => [s.planId, s.status])).toEqual([
      [starter.id, "ended"],
      [growth.id, "active"],
    ]);
    expect(subs[0].endedAt).not.toBeNull();
    expect(await mrrAt(new Date())).toBe(before - 199900 + 499900);
    const log = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "plan.changed", targetId: growth.id } });
    expect(JSON.parse(log.metadata)).toEqual({ from: starter.slug, to: growth.slug });
    // Re-assigning the same plan is a no-op.
    await clientPlan.PUT(req("/x", { method: "PUT", body: { planId: growth.id } }), params({ id: orgId }));
    expect(await db.subscription.count({ where: { organizationId: orgId } })).toBe(2);
  });

  it("enforces plan limits: seats and WhatsApp numbers; downgrade blocked when over limit", async () => {
    const { orgId } = await createClient(); // Starter: 2 seats, 1 number
    const owner = await asOwnerOf(orgId);
    actAs(owner);
    const add = (email: string) => membersRoute.POST(req("/x", { method: "POST", body: { email, name: "Seat", role: "AGENT", password: "Passw0rd!" } }), params({ orgId }));
    expect((await add(`s1-${uniq()}@x.local`)).status).toBe(201);
    const over = await json(await add(`s2-${uniq()}@x.local`));
    expect(over.status).toBe(409);
    expect(String(over.body.error)).toContain("seats");

    actAs(admin);
    expect((await clientNumbers.POST(req("/x", { method: "POST", body: { displayName: "Sales", phoneNumber: `+9198${Math.floor(10000000 + Math.random() * 89999999)}` } }), params({ id: orgId }))).status).toBe(201);
    expect((await clientNumbers.POST(req("/x", { method: "POST", body: { displayName: "Support", phoneNumber: `+9197${Math.floor(10000000 + Math.random() * 89999999)}` } }), params({ id: orgId }))).status).toBe(409);

    await clientPlan.PUT(req("/x", { method: "PUT", body: { planId: growth.id } }), params({ id: orgId }));
    const tiny = await makePlan({ maxUsers: 1 });
    expect((await clientPlan.PUT(req("/x", { method: "PUT", body: { planId: tiny.id } }), params({ id: orgId }))).status).toBe(409);
  });

  it("services enable/disable are persisted and audited individually", async () => {
    const { orgId } = await createClient({ services: [] });
    actAs(admin);
    const res = await clientServices.PUT(req("/x", { method: "PUT", body: { services: { HRMS: true, ATS: true } } }), params({ id: orgId }));
    expect(res.status).toBe(200);
    await clientServices.PUT(req("/x", { method: "PUT", body: { services: { HRMS: false, ATS: true } } }), params({ id: orgId }));
    const enabled = await db.organizationService.findMany({ where: { organizationId: orgId, enabled: true } });
    expect(enabled.map((s) => s.service)).toEqual(["ATS"]);
    expect(await db.auditLog.count({ where: { organizationId: orgId, action: "service.enabled" } })).toBe(2);
    expect(await db.auditLog.count({ where: { organizationId: orgId, action: "service.disabled", targetId: "HRMS" } })).toBe(1);
    expect((await clientServices.PUT(req("/x", { method: "PUT", body: { services: { NOT_A_SERVICE: true } } }), params({ id: orgId }))).status).toBe(400);
  });

  it("reset access: generated password works once shown, old sessions are revoked", async () => {
    const { orgId } = await createClient();
    const owner = await asOwnerOf(orgId);
    actAs(admin);
    const r = await json(await resetAccess.POST(req("/x", { method: "POST", body: {} }), params({ id: orgId })));
    expect(r.status).toBe(200);
    const pw = r.body.password as string;
    expect(pw.length).toBeGreaterThanOrEqual(12);
    const after = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(await bcrypt.compare(pw, after.passwordHash)).toBe(true);
    expect(after.sessionVersion).toBe(owner.sessionVersion + 1);
    actAs(owner); // old session
    expect((await meRoute.GET(req("/api/me"), {})).status).toBe(401);
    const log = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgId, action: "client.access_reset" } });
    expect(log.metadata).not.toContain(pw);
  });

  it("reset access cannot target users outside the client", async () => {
    const { orgId } = await createClient();
    const outsider = await makeUser();
    actAs(admin);
    expect((await resetAccess.POST(req("/x", { method: "POST", body: { userId: outsider.id } }), params({ id: orgId }))).status).toBe(404);
  });

  it("delete requires the exact name; removes exclusive users, keeps shared ones, logs client.deleted + user.deleted", async () => {
    const { orgId } = await createClient();
    const owner = await asOwnerOf(orgId);
    const shared = await makeUser();
    const otherOrg = await makeOrg("Other");
    await addMember(otherOrg.id, shared.id, "CLIENT_OWNER");
    await addMember(orgId, shared.id, "MANAGER");
    const name = (await db.organization.findUniqueOrThrow({ where: { id: orgId } })).name;

    actAs(admin);
    expect((await client.DELETE(req("/x", { method: "DELETE", body: { confirmName: "wrong" } }), params({ id: orgId }))).status).toBe(400);
    const res = await json(await client.DELETE(req("/x", { method: "DELETE", body: { confirmName: name } }), params({ id: orgId })));
    expect(res.status).toBe(200);
    expect(res.body.usersDeleted).toBe(1);
    expect(await db.organization.findUnique({ where: { id: orgId } })).toBeNull();
    expect(await db.user.findUnique({ where: { id: owner.id } })).toBeNull();
    expect(await db.user.findUnique({ where: { id: shared.id } })).not.toBeNull();
    expect(await db.subscription.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "client.deleted", targetId: orgId } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "user.deleted", targetId: owner.id } })).toBe(1);
  });

  it("user deletion safety rails", async () => {
    const { orgId } = await createClient();
    const owner = await asOwnerOf(orgId);
    actAs(admin);
    expect((await adminUser.DELETE(req("/x", { method: "DELETE" }), params({ id: admin.id }))).status).toBe(409); // self
    expect((await adminUser.DELETE(req("/x", { method: "DELETE" }), params({ id: owner.id }))).status).toBe(409); // last owner
    const agent = await makeUser();
    await addMember(orgId, agent.id, "AGENT");
    expect((await adminUser.DELETE(req("/x", { method: "DELETE" }), params({ id: agent.id }))).status).toBe(200);
    expect(await db.auditLog.count({ where: { action: "user.deleted", targetId: agent.id } })).toBe(1);
  });
});

describe("WhatsApp registry (no live connection)", () => {
  it("normalises numbers to E.164, rejects duplicates, starts as pending, logs add/update/remove", async () => {
    const { orgId } = await createClient({ planId: growth.id });
    actAs(admin);
    const local = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
    const added = await json(await clientNumbers.POST(req("/x", { method: "POST", body: { displayName: "Main", phoneNumber: local } }), params({ id: orgId })));
    expect(added.status).toBe(201);
    const acc = added.body.account as { id: string; phoneNumber: string; status: string; phoneNumberId: string };
    expect(acc.phoneNumber).toBe(`+91${local}`);
    expect(acc.status).toBe("pending");
    expect(acc.phoneNumberId).toBe("");
    expect((await clientNumbers.POST(req("/x", { method: "POST", body: { displayName: "Dup", phoneNumber: `+91${local}` } }), params({ id: orgId }))).status).toBe(409);
    expect((await clientNumbers.POST(req("/x", { method: "POST", body: { displayName: "Bad", phoneNumber: "12345" } }), params({ id: orgId }))).status).toBe(400);
    // "connected" can only be set by the future integration.
    expect((await number.PATCH(req("/x", { method: "PATCH", body: { status: "connected" } }), params({ id: acc.id }))).status).toBe(400);
    expect((await number.PATCH(req("/x", { method: "PATCH", body: { status: "disabled" } }), params({ id: acc.id }))).status).toBe(200);
    const list = await json(await numbers.GET(req("/api/admin/whatsapp-accounts?pageSize=100")));
    expect((list.body.items as { id: string }[]).some((a) => a.id === acc.id)).toBe(true);
    expect((await number.DELETE(req("/x", { method: "DELETE" }), params({ id: acc.id }))).status).toBe(200);
    const actions = (await db.auditLog.findMany({ where: { organizationId: orgId, action: { startsWith: "whatsapp." } } })).map((a) => a.action).sort();
    expect(actions).toEqual(["whatsapp.account_added", "whatsapp.account_removed", "whatsapp.account_updated"]);
  });
});

describe("plans & usage", () => {
  it("plan CRUD: rupees stored as paise, slug unique, assigned plans can't be deleted", async () => {
    actAs(admin);
    const slug = `p-${uniq()}`;
    const created = await json(await plans.POST(req("/x", { method: "POST", body: { name: "Pro X", slug, priceMonthly: 9999, maxUsers: 25, maxWhatsAppNumbers: 5, maxMonthlyMessages: 50000, maxContacts: 50000 } })));
    expect(created.status).toBe(201);
    const p = created.body.plan as { id: string; priceMonthly: number };
    expect(p.priceMonthly).toBe(999900);
    expect((await plans.POST(req("/x", { method: "POST", body: { name: "Dup", slug, priceMonthly: 1, maxUsers: 1, maxWhatsAppNumbers: 1, maxMonthlyMessages: 1, maxContacts: 1 } }))).status).toBe(409);
    expect((await planRoute.PATCH(req("/x", { method: "PATCH", body: { priceMonthly: 10999 } }), params({ id: p.id }))).status).toBe(200);
    expect((await db.plan.findUniqueOrThrow({ where: { id: p.id } })).priceMonthly).toBe(1099900);
    expect((await planRoute.DELETE(req("/x", { method: "DELETE" }), params({ id: starter.id }))).status).toBe(409);
    expect((await planRoute.DELETE(req("/x", { method: "DELETE" }), params({ id: p.id }))).status).toBe(200);
    const listed = await json(await plans.GET(req("/api/admin/plans")));
    expect(listed.body.summary).toEqual(expect.objectContaining({ mrr: expect.any(Number) }));
  });

  it("existing subscriptions keep their locked price after a plan price change", async () => {
    const pl = await makePlan({ priceMonthly: 100000 });
    const { orgId } = await createClient({ planId: pl.id });
    actAs(admin);
    await planRoute.PATCH(req("/x", { method: "PATCH", body: { priceMonthly: 5000 } }), params({ id: pl.id }));
    expect((await db.subscription.findFirstOrThrow({ where: { organizationId: orgId, status: "active" } })).priceMonthly).toBe(100000);
  });

  it("usage metering is read against plan limits", async () => {
    const { orgId } = await createClient();
    await incrementUsage(orgId, "messages_sent", 7);
    await incrementUsage(orgId, "messages_sent", 3);
    const summary = await getUsageSummary(orgId);
    expect(summary.find((u) => u.key === "messages")).toMatchObject({ used: 10 });
    expect(summary.find((u) => u.key === "users")).toMatchObject({ used: 1, limit: 2 });
    actAs(admin);
    const res = await json(await usage.GET(req("/api/admin/usage?pageSize=100")));
    const row = (res.body.items as { id: string; messages: { used: number } }[]).find((r) => r.id === orgId)!;
    expect(row.messages.used).toBe(10);
  });
});

describe("client users never get admin privileges", () => {
  it.each(["CLIENT_OWNER", "MANAGER", "AGENT"] as const)("%s → 403 on every client-management endpoint", async (role) => {
    const { orgId } = await createClient({ planId: growth.id });
    const u = await makeUser();
    if (role === "CLIENT_OWNER") {
      await addMember(orgId, u.id, "CLIENT_OWNER");
    } else {
      await addMember(orgId, u.id, role);
    }
    actAs(u);
    const p = params({ id: orgId });
    const calls: Promise<Response>[] = [
      clients.GET(req("/api/admin/organizations")),
      clients.POST(req("/x", { method: "POST", body: { name: "Mine", ownerName: "Me", ownerEmail: `me-${uniq()}@x.local`, ownerPassword: "Passw0rd!", planId: growth.id } })),
      client.GET(req("/x"), p),
      client.PATCH(req("/x", { method: "PATCH", body: { status: "active" } }), p),
      client.DELETE(req("/x", { method: "DELETE", body: { confirmName: "x" } }), p),
      clientServices.PUT(req("/x", { method: "PUT", body: { services: { HRMS: true } } }), p),
      clientPlan.PUT(req("/x", { method: "PUT", body: { planId: starter.id } }), p),
      resetAccess.POST(req("/x", { method: "POST", body: {} }), p),
      clientNumbers.POST(req("/x", { method: "POST", body: { displayName: "x", phoneNumber: "+919999999999" } }), p),
      numbers.GET(req("/api/admin/whatsapp-accounts")),
      plans.GET(req("/api/admin/plans")),
      plans.POST(req("/x", { method: "POST", body: {} })),
      usage.GET(req("/api/admin/usage")),
      adminUser.DELETE(req("/x", { method: "DELETE" }), params({ id: u.id })),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    // Even their own organization's plan/services were not touched.
    expect(await db.organizationService.count({ where: { organizationId: orgId, service: "HRMS", enabled: true } })).toBe(0);
    expect((await db.subscription.findFirstOrThrow({ where: { organizationId: orgId, status: "active" } })).planId).toBe(growth.id);
  });

  it("a client owner cannot assign the SUPER_ADMIN role or reach another client", async () => {
    const a = await createClient({ planId: growth.id });
    const b = await createClient({ planId: growth.id });
    const ownerA = await asOwnerOf(a.orgId);
    actAs(ownerA);
    const res = await membersRoute.POST(req("/x", { method: "POST", body: { email: `x-${uniq()}@x.local`, name: "X", role: "SUPER_ADMIN", password: "Passw0rd!" } }), params({ orgId: a.orgId }));
    expect(res.status).toBe(400);
    expect((await orgRoute.GET(req("/x"), params({ orgId: b.orgId }))).status).toBe(403);
    expect((await membersRoute.GET(req("/x"), params({ orgId: b.orgId }))).status).toBe(403);
  });

  it("a platform admin email can't be turned into a client owner", async () => {
    actAs(admin);
    const res = await clients.POST(req("/x", { method: "POST", body: { name: `Hijack ${uniq()}`, ownerName: "Hijacker", ownerEmail: admin.email, ownerPassword: "Passw0rd!", planId: starter.id } }));
    expect(res.status).toBe(409);
  });
});
