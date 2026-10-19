import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as bulk from "@/app/api/organizations/[orgId]/contacts/bulk-delete/route";

let n = 0;
const P = (orgId: string) => params({ orgId });
async function tenant(count: number) {
  const org = await makeOrg(`Bulk ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const manager = await makeUser({ name: "Manager" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  await addMember(org.id, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 20 });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  const base = Number(`9${String(Date.now()).slice(-8)}`) * 1000 + n * 1000;
  await db.contact.createMany({ data: Array.from({ length: count }, (_, i) => ({ organizationId: org.id, phone: `+${base + i}`, name: `C${i}`, source: i % 2 ? "import" : "manual", leadStatus: i % 2 ? "new" : "qualified" })) });
  return { org, owner, manager, agent };
}
const call = (orgId: string, body: unknown) => bulk.POST(req("/x", { method: "POST", body }), P(orgId));

describe("bulk contact delete", () => {
  it("deletes selected ids, only inside the caller's workspace", async () => {
    const a = await tenant(6);
    const b = await tenant(3);
    const mine = await db.contact.findMany({ where: { organizationId: a.org.id }, select: { id: true }, take: 3 });
    const theirs = await db.contact.findFirstOrThrow({ where: { organizationId: b.org.id } });
    actAs(a.owner);
    const r = await json(await call(a.org.id, { ids: [...mine.map((c) => c.id), theirs.id] }));
    expect(r.body).toEqual({ deleted: 3 });
    expect(await db.contact.count({ where: { organizationId: a.org.id } })).toBe(3);
    expect(await db.contact.count({ where: { organizationId: b.org.id } })).toBe(3);
    expect(await db.auditLog.count({ where: { organizationId: a.org.id, action: "contacts.bulk_deleted" } })).toBe(1);
  });

  it("deletes everything matching the filter, but only when the count matches what the user saw", async () => {
    const a = await tenant(10);
    actAs(a.owner);
    const filter = { leadStatus: "qualified" }; // 5 of 10
    expect((await call(a.org.id, { filter, expectedCount: 4 })).status).toBe(409);
    expect(await db.contact.count({ where: { organizationId: a.org.id } })).toBe(10);
    const r = await json(await call(a.org.id, { filter, expectedCount: 5 }));
    expect(r.body).toEqual({ deleted: 5 });
    expect(await db.contact.count({ where: { organizationId: a.org.id, leadStatus: "qualified" } })).toBe(0);
    expect(await db.contact.count({ where: { organizationId: a.org.id } })).toBe(5);
  });

  it("also removes the contact's chats; agents are refused; garbage is rejected", async () => {
    const a = await tenant(2);
    const c = await db.contact.findFirstOrThrow({ where: { organizationId: a.org.id } });
    const waba = await db.whatsAppBusinessAccount.create({ data: { organizationId: a.org.id, wabaId: `w${Math.random()}`, name: "W", isDemo: true } });
    const acct = await db.whatsAppAccount.create({ data: { organizationId: a.org.id, wabaRecordId: waba.id, phoneNumber: `+91${Math.floor(Math.random() * 1e10)}`, displayName: "N", status: "demo", isDemo: true } });
    await db.conversation.create({ data: { organizationId: a.org.id, contactId: c.id, whatsappAccountId: acct.id } });
    actAs(a.agent);
    expect((await call(a.org.id, { ids: [c.id] })).status).toBe(403);
    actAs(a.manager); // managers hold contacts:delete
    expect((await call(a.org.id, { ids: [c.id] })).status).toBe(200);
    expect(await db.conversation.count({ where: { organizationId: a.org.id } })).toBe(0);
    for (const bad of [{}, { ids: [] }, { ids: ["x".repeat(100)] }, { ids: [c.id], extra: 1 }, { filter: {}, expectedCount: 0 }, { filter: { tab: "nope" }, expectedCount: 1 }]) {
      expect((await call(a.org.id, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });
});
