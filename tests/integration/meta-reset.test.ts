import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { actAs, json, makeOrg, makeUser, req } from "../helpers";
import * as route from "@/app/api/admin/meta-reset/route";

afterEach(() => vi.restoreAllMocks());
const post = (body: unknown) => route.POST(req("/x", { method: "POST", body }), { params: Promise.resolve({}) } as never);

describe("admin reset of Meta connections", () => {
  it("is super admin only and needs the RESET word", async () => {
    const owner = await makeUser({});
    actAs(owner);
    expect((await json(await post({ confirm: "RESET" }))).status).toBe(403);
    const admin = await makeUser({ role: "SUPER_ADMIN" });
    actAs(admin);
    expect((await json(await post({}))).status).toBe(400);
  });

  it("wipes tokens and links but keeps conversations and history", async () => {
    const org = await makeOrg("Reset Org");
    const conn = await db.whatsAppConnection.create({
      data: { organizationId: org.id, method: "embedded_signup", status: "active", encryptedAccessToken: "enc-token", tokenLast4: "1234", encryptedAppSecret: "enc-secret" },
    });
    const acc = await db.whatsAppAccount.create({
      data: { organizationId: org.id, displayName: "Main", phoneNumber: "+919800000001", status: "connected", connectionId: conn.id },
    });
    const demo = await db.whatsAppAccount.create({
      data: { organizationId: org.id, displayName: "Demo", phoneNumber: "+919800000002", status: "demo", isDemo: true },
    });
    await db.adConnection.create({ data: { organizationId: org.id, adAccountId: "123", pageId: "9", encryptedToken: "enc" } });
    const ch = await db.channelAccount.create({
      data: { organizationId: org.id, kind: "instagram", name: "IG", publicKey: `pk_${Date.now()}`, status: "active", encryptedToken: "enc-ig" },
    });
    const contact = await db.contact.create({ data: { organizationId: org.id, phone: "+919811111111", name: "Cust" } as never });
    const conv = await db.conversation.create({ data: { organizationId: org.id, contactId: contact.id, whatsappAccountId: acc.id } });

    const admin = await makeUser({ role: "SUPER_ADMIN" });
    actAs(admin);
    const r = await json(await post({ confirm: "RESET" }));
    expect(r.status).toBe(200);
    expect(r.body.adConnections).toBeGreaterThanOrEqual(1);

    const a = await db.whatsAppAccount.findUnique({ where: { id: acc.id } });
    expect(a?.status).toBe("disconnected");
    const c = await db.whatsAppConnection.findUnique({ where: { id: conn.id } });
    expect(c?.encryptedAccessToken).toBe("");
    expect(c?.encryptedAppSecret).toBe("");
    expect(c?.status).toBe("disconnected");
    expect(await db.adConnection.count({ where: { organizationId: org.id } })).toBe(0);
    const i = await db.channelAccount.findUnique({ where: { id: ch.id } });
    expect(i?.encryptedToken).toBe("");
    expect(i?.status).toBe("disabled");
    expect((await db.whatsAppAccount.findUnique({ where: { id: demo.id } }))?.status).toBe("demo");
    expect(await db.conversation.findUnique({ where: { id: conv.id } })).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "admin.meta_reset" } })).toBeGreaterThan(0);
  });
});
