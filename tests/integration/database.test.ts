import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify, listNotifications, markAllRead } from "@/lib/notifications";
import { addMember, makeOrg, makeUser } from "../helpers";

describe("database foundation", () => {
  it("connects", async () => {
    const [row] = await db.$queryRawUnsafe<{ ok: number | bigint }[]>("SELECT 1 as ok");
    expect(Number(row.ok)).toBe(1);
  });

  it("organization CRUD", async () => {
    const org = await makeOrg("Crud Co");
    expect((await db.organization.findUnique({ where: { id: org.id } }))?.status).toBe("active");
    await db.organization.update({ where: { id: org.id }, data: { name: "Crud Co 2" } });
    expect((await db.organization.findUnique({ where: { id: org.id } }))?.name).toBe("Crud Co 2");
    await db.organization.delete({ where: { id: org.id } });
    expect(await db.organization.findUnique({ where: { id: org.id } })).toBeNull();
  });

  it("enforces unique slugs and unique membership per org", async () => {
    const org = await makeOrg("Uniq");
    await expect(db.organization.create({ data: { name: "Dup", slug: org.slug } })).rejects.toThrow();
    const u = await makeUser();
    await addMember(org.id, u.id, "AGENT");
    await expect(addMember(org.id, u.id, "MANAGER")).rejects.toThrow();
  });

  it("relations + cascades: deleting an org removes memberships, keeps users; audit actor survives as null", async () => {
    const org = await makeOrg("Cascade");
    const u = await makeUser();
    await addMember(org.id, u.id, "CLIENT_OWNER");
    await audit({ action: "organization.updated", actorUserId: u.id, organizationId: org.id });
    const withMembers = await db.organization.findUniqueOrThrow({ where: { id: org.id }, include: { members: { include: { user: true } } } });
    expect(withMembers.members[0].user.id).toBe(u.id);

    await db.organization.delete({ where: { id: org.id } });
    expect(await db.organizationMember.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await db.user.findUnique({ where: { id: u.id } })).not.toBeNull();
    const log = await db.auditLog.findFirstOrThrow({ where: { actorUserId: u.id, action: "organization.updated" } });
    expect(log.organizationId).toBeNull();

    await db.user.delete({ where: { id: u.id } });
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: log.id } })).actorUserId).toBeNull();
  });

  it("audit metadata is redacted before it is stored", async () => {
    const u = await makeUser();
    await audit({ action: "settings.changed", actorUserId: u.id, metadata: { field: "x", password: "p", token: "t" } });
    const row = await db.auditLog.findFirstOrThrow({ where: { actorUserId: u.id, action: "settings.changed" } });
    expect(row.metadata).not.toContain('"p"');
    expect(row.metadata).toContain("[redacted]");
  });

  it("notifications: create, unread count, mark all read; external links are dropped", async () => {
    const u = await makeUser();
    await notify({ userId: u.id, title: "One", link: "/dashboard" });
    await notify({ userId: u.id, title: "Two", link: "https://evil.example" });
    const list = await listNotifications(u.id, { page: 1, pageSize: 10 });
    expect(list.unread).toBe(2);
    expect(list.items.map((n) => n.link).sort()).toEqual(["", "/dashboard"]);
    expect(await markAllRead(u.id)).toBe(2);
    expect((await listNotifications(u.id, { page: 1, pageSize: 10 })).unread).toBe(0);
  });
});
