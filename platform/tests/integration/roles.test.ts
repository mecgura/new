import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as adminOrgs from "@/app/api/admin/organizations/route";
import * as adminOrg from "@/app/api/admin/organizations/[id]/route";
import * as adminUsers from "@/app/api/admin/users/route";
import * as adminUser from "@/app/api/admin/users/[id]/route";
import * as adminAudit from "@/app/api/admin/audit-logs/route";
import * as orgRoute from "@/app/api/organizations/[orgId]/route";
import * as membersRoute from "@/app/api/organizations/[orgId]/members/route";
import * as memberRoute from "@/app/api/organizations/[orgId]/members/[memberId]/route";
import { proxy } from "@/proxy";

type U = Awaited<ReturnType<typeof makeUser>>;
let superAdmin: U, owner: U, manager: U, agent: U, legacyAdmin: U;
let org: { id: string };
let plan: { id: string };

beforeAll(async () => {
  superAdmin = await makeUser({ role: "SUPER_ADMIN", name: "Super" });
  legacyAdmin = await makeUser({ role: "admin", name: "Legacy admin" });
  owner = await makeUser({ name: "Owner" });
  manager = await makeUser({ name: "Manager" });
  agent = await makeUser({ name: "Agent" });
  org = await makeOrg("Role Test Org");
  plan = await makePlan({ maxUsers: 50 });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent.id, "AGENT");
});

const adminCalls = () => [
  () => adminOrgs.GET(req("/api/admin/organizations")),
  () => adminUsers.GET(req("/api/admin/users")),
  () => adminAudit.GET(req("/api/admin/audit-logs")),
  () => adminOrg.GET(req(`/api/admin/organizations/${org.id}`), params({ id: org.id })),
];

describe("/admin API access by role", () => {
  it("SUPER_ADMIN → allowed (200)", async () => {
    actAs(superAdmin);
    for (const call of adminCalls()) expect((await call()).status).toBe(200);
  });

  it("legacy 'admin' role rows are treated as SUPER_ADMIN", async () => {
    actAs(legacyAdmin);
    expect((await adminOrgs.GET(req("/api/admin/organizations"))).status).toBe(200);
  });

  it.each([
    ["CLIENT_OWNER", () => owner],
    ["MANAGER", () => manager],
    ["AGENT", () => agent],
  ])("%s → denied (403)", async (_role, who) => {
    actAs(who());
    for (const call of adminCalls()) {
      const res = await call();
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("FORBIDDEN");
    }
    const create = await adminOrgs.POST(
      req("/api/admin/organizations", { method: "POST", body: { name: "Evil Co", ownerName: "Evil", ownerEmail: "evil@x.local", ownerPassword: "Passw0rd!", planId: plan.id } })
    );
    expect(create.status).toBe(403);
    expect(await db.organization.findFirst({ where: { name: "Evil Co" } })).toBeNull();
  });

  it("signed out → 401", async () => {
    actAs(null);
    for (const call of adminCalls()) expect((await call()).status).toBe(401);
  });
});

describe("SUPER_ADMIN operations", () => {
  it("creates an organization with its CLIENT_OWNER (hashed password, audit + notification)", async () => {
    actAs(superAdmin);
    const email = `owner-${Date.now()}@client.local`;
    const { status, body } = await json(
      await adminOrgs.POST(req("/api/admin/organizations", { method: "POST", body: { name: "Jay Shri Enterprises", ownerName: "Jay", ownerEmail: email, ownerPassword: "Passw0rd!", planId: plan.id } }))
    );
    expect(status).toBe(201);
    const orgId = (body.organization as { id: string }).id;
    const user = await db.user.findUnique({ where: { email }, include: { memberships: true } });
    expect(user?.passwordHash).not.toContain("Passw0rd");
    expect(user?.passwordHash.startsWith("$2")).toBe(true);
    expect(user?.role).toBe("USER");
    expect(user?.memberships).toEqual([expect.objectContaining({ organizationId: orgId, role: "CLIENT_OWNER" })]);
    expect(await db.auditLog.count({ where: { action: "client.created", organizationId: orgId } })).toBe(1);
    expect(await db.notification.count({ where: { userId: user!.id } })).toBe(1);
  });

  it("rejects invalid payloads with 400 + field details", async () => {
    actAs(superAdmin);
    const { status, body } = await json(await adminOrgs.POST(req("/api/admin/organizations", { method: "POST", body: { name: "x", ownerEmail: "bad" } })));
    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(body.details as object)).toEqual(expect.arrayContaining(["name", "ownerEmail", "ownerPassword", "planId"]));
  });

  it("disabling a user kills their sessions immediately", async () => {
    const victim = await makeUser();
    actAs(superAdmin);
    expect((await adminUser.PATCH(req(`/api/admin/users/${victim.id}`, { method: "PATCH", body: { status: "disabled" } }), params({ id: victim.id }))).status).toBe(200);
    actAs(victim); // still holding the old session token
    expect((await orgRoute.GET(req(`/api/organizations/${org.id}`), params({ orgId: org.id }))).status).toBe(401);
  });

  it("cannot disable own account", async () => {
    actAs(superAdmin);
    expect((await adminUser.PATCH(req(`/api/admin/users/${superAdmin.id}`, { method: "PATCH", body: { status: "disabled" } }), params({ id: superAdmin.id }))).status).toBe(409);
  });
});

describe("tenant roles inside an organization", () => {
  it("MANAGER can view members but not manage them or edit the org", async () => {
    actAs(manager);
    expect((await membersRoute.GET(req(`/api/organizations/${org.id}/members`), params({ orgId: org.id }))).status).toBe(200);
    expect((await orgRoute.PATCH(req(`/api/organizations/${org.id}`, { method: "PATCH", body: { name: "Nope" } }), params({ orgId: org.id }))).status).toBe(403);
    expect(
      (await membersRoute.POST(req(`/api/organizations/${org.id}/members`, { method: "POST", body: { email: "m@x.local", name: "New", role: "AGENT", password: "Passw0rd!" } }), params({ orgId: org.id }))).status
    ).toBe(403);
  });

  it("AGENT can read the org but not the member list", async () => {
    actAs(agent);
    expect((await orgRoute.GET(req(`/api/organizations/${org.id}`), params({ orgId: org.id }))).status).toBe(200);
    expect((await membersRoute.GET(req(`/api/organizations/${org.id}/members`), params({ orgId: org.id }))).status).toBe(403);
  });

  it("CLIENT_OWNER manages members; the last owner cannot be removed or demoted", async () => {
    actAs(owner);
    const add = await json(
      await membersRoute.POST(req(`/api/organizations/${org.id}/members`, { method: "POST", body: { email: `new-${Date.now()}@x.local`, name: "New Agent", role: "AGENT", password: "Passw0rd!" } }), params({ orgId: org.id }))
    );
    expect(add.status).toBe(201);
    const newMemberId = (add.body.member as { id: string }).id;
    expect((await memberRoute.PATCH(req("/x", { method: "PATCH", body: { role: "MANAGER" } }), params({ orgId: org.id, memberId: newMemberId }))).status).toBe(200);
    expect((await memberRoute.DELETE(req("/x", { method: "DELETE" }), params({ orgId: org.id, memberId: newMemberId }))).status).toBe(200);

    const ownerMember = await db.organizationMember.findFirstOrThrow({ where: { organizationId: org.id, userId: owner.id } });
    expect((await memberRoute.PATCH(req("/x", { method: "PATCH", body: { role: "AGENT" } }), params({ orgId: org.id, memberId: ownerMember.id }))).status).toBe(409);
    expect((await memberRoute.DELETE(req("/x", { method: "DELETE" }), params({ orgId: org.id, memberId: ownerMember.id }))).status).toBe(409);
  });

  it("adding an existing member twice → 409", async () => {
    actAs(owner);
    const res = await membersRoute.POST(req(`/api/organizations/${org.id}/members`, { method: "POST", body: { email: agent.email, name: "Agent", role: "AGENT" } }), params({ orgId: org.id }));
    expect(res.status).toBe(409);
  });
});

describe("proxy (first-line route gate)", () => {
  async function cookieFor(user: { id: string; role: string } | null) {
    if (!user) return "";
    const token = await encode({ token: { id: user.id, role: user.role, sv: 0 }, secret: process.env.AUTH_SECRET!, salt: "authjs.session-token" });
    return `authjs.session-token=${token}`;
  }
  const hit = async (path: string, user: { id: string; role: string } | null) =>
    proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: await cookieFor(user) } }));

  it("SUPER_ADMIN → /admin passes", async () => {
    const res = await hit("/admin", superAdmin);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each([
    ["CLIENT_OWNER", () => owner],
    ["MANAGER", () => manager],
    ["AGENT", () => agent],
  ])("%s → /admin is redirected away", async (_r, who) => {
    const res = await hit("/admin/organizations", who());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard?denied=admin");
  });

  it("signed out → /dashboard, /settings, /admin redirect to /login", async () => {
    for (const p of ["/dashboard", "/settings/team", "/admin"]) {
      const res = await hit(p, null);
      expect(res.headers.get("location")).toContain("/login?callbackUrl=");
    }
  });

  it("public pages are untouched", async () => {
    expect((await hit("/", null)).headers.get("location")).toBeNull();
  });
});
