import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import * as orgRoute from "@/app/api/organizations/[orgId]/route";
import * as membersRoute from "@/app/api/organizations/[orgId]/members/route";
import * as memberRoute from "@/app/api/organizations/[orgId]/members/[memberId]/route";
import * as auditRoute from "@/app/api/organizations/[orgId]/audit-logs/route";
import * as activeOrgRoute from "@/app/api/me/active-organization/route";
import * as notificationRoute from "@/app/api/notifications/[id]/route";

type U = Awaited<ReturnType<typeof makeUser>>;
let orgA: { id: string }, orgB: { id: string };
let userA: U, userB: U;
let memberA2: { id: string }, memberB2: { id: string };

beforeAll(async () => {
  orgA = await makeOrg("Organization A");
  orgB = await makeOrg("Organization B");
  userA = await makeUser({ name: "User A" });
  userB = await makeUser({ name: "User B" });
  await addMember(orgA.id, userA.id, "CLIENT_OWNER");
  await addMember(orgB.id, userB.id, "CLIENT_OWNER");
  // A second member in each org, used as cross-tenant targets.
  memberA2 = await addMember(orgA.id, (await makeUser({ name: "Agent A" })).id, "AGENT");
  memberB2 = await addMember(orgB.id, (await makeUser({ name: "Agent B" })).id, "AGENT");
});

const getOrg = (orgId: string) => orgRoute.GET(req(`/api/organizations/${orgId}`), params({ orgId }));
const patchOrg = (orgId: string, name: string) => orgRoute.PATCH(req(`/api/organizations/${orgId}`, { method: "PATCH", body: { name } }), params({ orgId }));
const listMembers = (orgId: string) => membersRoute.GET(req(`/api/organizations/${orgId}/members`), params({ orgId }));
const addMemberReq = (orgId: string, email: string) =>
  membersRoute.POST(req(`/api/organizations/${orgId}/members`, { method: "POST", body: { email, name: "Intruder", role: "AGENT", password: "Passw0rd!" } }), params({ orgId }));
const patchMember = (orgId: string, memberId: string) =>
  memberRoute.PATCH(req(`/api/organizations/${orgId}/members/${memberId}`, { method: "PATCH", body: { role: "MANAGER" } }), params({ orgId, memberId }));
const deleteMember = (orgId: string, memberId: string) =>
  memberRoute.DELETE(req(`/api/organizations/${orgId}/members/${memberId}`, { method: "DELETE" }), params({ orgId, memberId }));
const auditLogs = (orgId: string) => auditRoute.GET(req(`/api/organizations/${orgId}/audit-logs`), params({ orgId }));

describe("User A → Organization A (allowed)", () => {
  it("reads, lists members, reads audit log, updates", async () => {
    actAs(userA);
    expect((await getOrg(orgA.id)).status).toBe(200);
    expect((await listMembers(orgA.id)).status).toBe(200);
    expect((await auditLogs(orgA.id)).status).toBe(200);
    const res = await json(await patchOrg(orgA.id, "Organization A Renamed"));
    expect(res.status).toBe(200);
    expect((await db.organization.findUnique({ where: { id: orgA.id } }))?.name).toBe("Organization A Renamed");
  });
});

describe("User B → Organization B (allowed)", () => {
  it("reads and lists members", async () => {
    actAs(userB);
    expect((await getOrg(orgB.id)).status).toBe(200);
    const { body } = await json(await listMembers(orgB.id));
    const emails = (body.members as { user: { email: string } }[]).map((m) => m.user.email);
    expect(emails).toContain(userB.email);
    expect(emails).not.toContain(userA.email);
  });
});

describe.each([
  ["User A → Organization B", () => userA, () => orgB, () => memberB2],
  ["User B → Organization A", () => userB, () => orgA, () => memberA2],
] as const)("%s (denied)", (_label, actor, victimOrg, victimMember) => {
  it("cannot READ the other tenant (org, members, audit log)", async () => {
    actAs(actor());
    for (const res of [await getOrg(victimOrg().id), await listMembers(victimOrg().id), await auditLogs(victimOrg().id)]) {
      const { status, body } = await json(res);
      expect(status).toBe(403);
      expect(body.code).toBe("FORBIDDEN");
      expect(JSON.stringify(body)).not.toContain("Organization");
    }
  });

  it("cannot MODIFY the other tenant", async () => {
    actAs(actor());
    const before = await db.organization.findUnique({ where: { id: victimOrg().id } });
    expect((await patchOrg(victimOrg().id, "Hacked")).status).toBe(403);
    expect((await addMemberReq(victimOrg().id, `intruder-${Date.now()}@x.local`)).status).toBe(403);
    expect((await patchMember(victimOrg().id, victimMember().id)).status).toBe(403);
    const after = await db.organization.findUnique({ where: { id: victimOrg().id } });
    expect(after?.name).toBe(before?.name);
    expect((await db.organizationMember.findUnique({ where: { id: victimMember().id } }))?.role).toBe("AGENT");
  });

  it("cannot DELETE in the other tenant", async () => {
    actAs(actor());
    expect((await deleteMember(victimOrg().id, victimMember().id)).status).toBe(403);
    expect(await db.organizationMember.findUnique({ where: { id: victimMember().id } })).not.toBeNull();
  });

  it("cannot reach another tenant's member through its OWN org path (id smuggling)", async () => {
    actAs(actor());
    const ownOrg = victimOrg().id === orgA.id ? orgB : orgA;
    expect((await patchMember(ownOrg.id, victimMember().id)).status).toBe(404);
    expect((await deleteMember(ownOrg.id, victimMember().id)).status).toBe(404);
    expect(await db.organizationMember.findUnique({ where: { id: victimMember().id } })).not.toBeNull();
  });

  it("cannot switch the active workspace to the other tenant", async () => {
    actAs(actor());
    const res = await activeOrgRoute.POST(req("/api/me/active-organization", { method: "POST", body: { organizationId: victimOrg().id } }));
    expect(res.status).toBe(403);
  });

  it("denials are audit-logged without leaking into the victim tenant's log", async () => {
    const denied = await db.auditLog.findMany({ where: { action: "permission.denied", actorUserId: actor().id, targetId: victimOrg().id } });
    expect(denied.length).toBeGreaterThan(0);
    expect(denied.every((d) => d.organizationId === null)).toBe(true);
  });
});

describe("other isolation guarantees", () => {
  it("unknown organization ids look identical to foreign ones (403, no probing)", async () => {
    actAs(userA);
    expect((await getOrg("does-not-exist")).status).toBe(403);
  });

  it("signed-out requests get 401", async () => {
    actAs(null);
    const { status, body } = await json(await getOrg(orgA.id));
    expect(status).toBe(401);
    expect(body.code).toBe("UNAUTHENTICATED");
  });

  it("users cannot mark another user's notification as read", async () => {
    const n = await db.notification.create({ data: { userId: userB.id, title: "Private to B" } });
    actAs(userA);
    expect((await notificationRoute.PATCH(req(`/api/notifications/${n.id}`, { method: "PATCH" }), params({ id: n.id }))).status).toBe(404);
    expect((await db.notification.findUnique({ where: { id: n.id } }))?.readAt).toBeNull();
  });

  it("suspended organizations deny their own members", async () => {
    const org = await makeOrg("Suspended Co");
    const owner = await makeUser();
    await addMember(org.id, owner.id, "CLIENT_OWNER");
    await db.organization.update({ where: { id: org.id }, data: { status: "suspended" } });
    actAs(owner);
    expect((await getOrg(org.id)).status).toBe(403);
  });
});
