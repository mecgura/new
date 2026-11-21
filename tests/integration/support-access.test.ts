import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { actAs, json, makeOrg, makeUser, req } from "../helpers";
import * as open from "@/app/api/admin/clients/[id]/open-workspace/route";
import * as exit from "@/app/api/admin/exit-workspace/route";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  jar.clear();
});
const openFor = (id: string) => open.POST(req("/x", { method: "POST" }), { params: Promise.resolve({ id }) } as never);
const leave = () => exit.POST(req("/x", { method: "POST" }), { params: Promise.resolve({}) } as never);

describe("Super Admin support access to a client workspace", () => {
  it("is refused for client owners and sets no cookie", async () => {
    const org = await makeOrg("Locked Org");
    actAs(await makeUser({}));
    expect((await json(await openFor(org.id))).status).toBe(403);
    expect(jar.size).toBe(0);
  });

  it("opens, audits and leaves a workspace for a Super Admin", async () => {
    const org = await makeOrg("Support Org");
    const admin = await makeUser({ role: "SUPER_ADMIN" });
    actAs(admin);
    expect((await json(await openFor(org.id))).status).toBe(200);
    expect(jar.get("mecgura_org")).toBe(org.id);
    expect(await db.auditLog.count({ where: { action: "admin.workspace_opened", organizationId: org.id, actorUserId: admin.id } })).toBe(1);
    expect((await json(await leave())).status).toBe(200);
    expect(jar.has("mecgura_org")).toBe(false);
    expect(await db.auditLog.count({ where: { action: "admin.workspace_closed", organizationId: org.id } })).toBe(1);
  });

  it("404s for an unknown client", async () => {
    actAs(await makeUser({ role: "SUPER_ADMIN" }));
    expect((await json(await openFor("does-not-exist"))).status).toBe(404);
  });
});
