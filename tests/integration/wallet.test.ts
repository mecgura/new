import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import * as adminWallet from "@/app/api/admin/organizations/[id]/wallet/route";
import * as clientWallet from "@/app/api/organizations/[orgId]/wallet/route";
import { creditWallet, debitWallet, getWallet } from "@/services/wallet";

async function setup() {
  const admin = await makeUser({ role: "SUPER_ADMIN", name: "Admin" });
  const org = await makeOrg("Wallet Client");
  const owner = await makeUser({ name: "Owner" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, agent.id, "AGENT");
  return { admin, org, owner, agent };
}
const move = (body: Record<string, unknown>) => req("/x", { method: "POST", body });
const actor = (id: string) => ({ actorUserId: id });

describe("wallet: admin adds and deducts", () => {
  it("credits in rupees, stores paise, writes a ledger row, audits and notifies the owner", async () => {
    const { admin, org, owner } = await setup();
    actAs(admin);
    const r = await json(await adminWallet.POST(move({ direction: "credit", amountRupees: 5000.5, reference: "UPI-123", note: "October" }), params({ id: org.id })));
    expect(r.status).toBe(201);
    expect((r.body.wallet as { balance: number }).balance).toBe(500_050);
    const entry = await db.walletEntry.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(entry).toMatchObject({ direction: "credit", amount: 500_050, balanceAfter: 500_050, reason: "topup", reference: "UPI-123", createdById: admin.id });
    expect(await db.auditLog.count({ where: { organizationId: org.id, action: "wallet.credited" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: owner.id, title: "Wallet credited" } })).toBe(1);
  });

  it("deducts, refuses to go below zero, and keeps the balance equal to the ledger", async () => {
    const { admin, org } = await setup();
    actAs(admin);
    await adminWallet.POST(move({ direction: "credit", amountRupees: 100 }), params({ id: org.id }));
    expect((await adminWallet.POST(move({ direction: "debit", amountRupees: 40 }), params({ id: org.id }))).status).toBe(201);
    const over = await json(await adminWallet.POST(move({ direction: "debit", amountRupees: 61 }), params({ id: org.id })));
    expect(over.status).toBe(409);
    expect(String(over.body.error)).toMatch(/Not enough wallet balance/);
    expect((await getWallet(org.id)).balance).toBe(6_000);
    const rows = await db.walletEntry.findMany({ where: { organizationId: org.id } });
    const sum = rows.reduce((t, e) => t + (e.direction === "credit" ? e.amount : -e.amount), 0);
    expect(sum).toBe(6_000);
  });

  it("rejects zero, negative, fractional-paise and absurd amounts without touching the balance", async () => {
    const { admin, org } = await setup();
    actAs(admin);
    for (const amountRupees of [0, -5, 10.005, 2_000_000]) {
      const r = await adminWallet.POST(move({ direction: "credit", amountRupees }), params({ id: org.id }));
      expect(r.status, String(amountRupees)).toBe(400);
    }
    expect((await getWallet(org.id)).balance).toBe(0);
  });

  it("a repeated request id is applied once", async () => {
    const { admin, org } = await setup();
    actAs(admin);
    const body = { direction: "credit", amountRupees: 250, idempotencyKey: "retry-key-0001" };
    const a = await json(await adminWallet.POST(move(body), params({ id: org.id })));
    const b = await json(await adminWallet.POST(move(body), params({ id: org.id })));
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.replayed).toBe(true);
    expect((await getWallet(org.id)).balance).toBe(25_000);
    expect(await db.walletEntry.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("concurrent debits can never overdraw the wallet", async () => {
    const { admin, org } = await setup();
    await creditWallet(org.id, actor(admin.id), { amount: 10_000 });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => debitWallet(org.id, actor(admin.id), { amount: 3_000 })));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(3);
    expect((await getWallet(org.id)).balance).toBe(1_000);
  });

  it("low-balance alert: notifies the owner once when a debit crosses the line", async () => {
    const { admin, org, owner } = await setup();
    actAs(admin);
    await adminWallet.POST(move({ direction: "credit", amountRupees: 100 }), params({ id: org.id }));
    const set = await json(await adminWallet.PATCH(req("/x", { method: "PATCH", body: { lowBalanceRupees: 50 } }), params({ id: org.id })));
    expect((set.body.wallet as { lowBalanceThreshold: number }).lowBalanceThreshold).toBe(5_000);
    await adminWallet.POST(move({ direction: "debit", amountRupees: 60 }), params({ id: org.id }));
    await adminWallet.POST(move({ direction: "debit", amountRupees: 5 }), params({ id: org.id }));
    expect(await db.notification.count({ where: { userId: owner.id, title: "Wallet balance is low" } })).toBe(1);
    expect((await getWallet(org.id)).low).toBe(true);
  });
});

describe("wallet: access rules", () => {
  it("only a Super Admin can add or deduct; a client owner cannot even if they try the admin route", async () => {
    const { owner, org } = await setup();
    actAs(owner);
    expect((await adminWallet.POST(move({ direction: "credit", amountRupees: 1 }), params({ id: org.id }))).status).toBe(403);
    expect((await adminWallet.GET(req("/x"), params({ id: org.id }))).status).toBe(403);
    actAs(null);
    expect((await adminWallet.GET(req("/x"), params({ id: org.id }))).status).toBe(401);
    expect((await getWallet(org.id)).balance).toBe(0);
  });

  it("owners and managers see their own balance and ledger; agents do not; other workspaces are separate", async () => {
    const a = await setup();
    const b = await setup();
    await creditWallet(a.org.id, actor(a.admin.id), { amount: 12_345, reference: "REF-A" });
    await creditWallet(b.org.id, actor(b.admin.id), { amount: 99_900, reference: "REF-B" });

    actAs(a.owner);
    const mine = await json(await clientWallet.GET(req("/x"), params({ orgId: a.org.id })));
    expect(mine.status).toBe(200);
    expect((mine.body.wallet as { balance: number }).balance).toBe(12_345);
    expect(JSON.stringify(mine.body)).not.toContain("REF-B");

    actAs(a.agent);
    expect((await clientWallet.GET(req("/x"), params({ orgId: a.org.id }))).status).toBe(403);

    actAs(a.owner);
    expect([403, 404]).toContain((await clientWallet.GET(req("/x"), params({ orgId: b.org.id }))).status);
  });

  it("a client's wallet endpoint has no way to add money", async () => {
    const mod = clientWallet as Record<string, unknown>;
    expect(Object.keys(mod).filter((k) => ["POST", "PUT", "PATCH", "DELETE"].includes(k))).toEqual([]);
  });
});
