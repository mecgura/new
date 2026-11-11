import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { tenantDb } from "./db";

let A: string, B: string, roleId: string;

beforeAll(async () => {
  const role = await db.role.create({ data: { key: "DOCTOR", name: "Doctor" } });
  roleId = role.id;
  A = (await db.tenant.create({ data: { name: "Clinic A", slug: "clinic-a" } })).id;
  B = (await db.tenant.create({ data: { name: "Clinic B", slug: "clinic-b" } })).id;
  await db.user.create({ data: { email: "a@a.test", name: "A", passwordHash: "x", roleId, tenantId: A } });
  await db.user.create({ data: { email: "b@b.test", name: "B", passwordHash: "x", roleId, tenantId: B } });
});
afterAll(async () => { await db.$disconnect(); });

describe("tenantDb against a real database", () => {
  it("only returns the caller's tenant rows, even with a hostile filter", async () => {
    const tdb = tenantDb({ tenantId: A });
    expect((await tdb.user.findMany()).map((u) => u.email)).toEqual(["a@a.test"]);
    expect(await tdb.user.findMany({ where: { tenantId: B } })).toHaveLength(0);
    expect(await tdb.user.findMany({ where: { OR: [{ tenantId: B }, { email: "b@b.test" }] } })).toHaveLength(0);
  });
  it("cannot read or modify another tenant's row by id", async () => {
    const victim = await db.user.findFirstOrThrow({ where: { email: "b@b.test" } });
    const tdb = tenantDb({ tenantId: A });
    expect(await tdb.user.findUnique({ where: { id: victim.id } })).toBeNull();
    await expect(tdb.user.update({ where: { id: victim.id }, data: { name: "hacked" } })).rejects.toThrow();
    expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).name).toBe("B");
  });
  it("stamps tenantId on create and refuses cross-tenant creates", async () => {
    const tdb = tenantDb({ tenantId: A });
    const u = await tdb.user.create({ data: { email: "a2@a.test", name: "A2", passwordHash: "x", roleId } as never });
    expect(u.tenantId).toBe(A);
    await expect(tdb.user.create({ data: { email: "evil@a.test", name: "E", passwordHash: "x", roleId, tenantId: B } as never })).rejects.toThrow();
  });
  it("hides soft-deleted rows", async () => {
    const tdb = tenantDb({ tenantId: A });
    await db.user.updateMany({ where: { email: "a2@a.test" }, data: { deletedAt: new Date() } });
    expect((await tdb.user.findMany()).map((u) => u.email)).toEqual(["a@a.test"]);
  });
});
