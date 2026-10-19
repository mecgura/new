import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import { registerGateway, unregisterGateway } from "@/providers/payments/registry";
import { GatewayError, type PaymentGateway } from "@/providers/payments/types";
import * as topup from "@/app/api/organizations/[orgId]/wallet/topup/route";
import * as walletRoute from "@/app/api/organizations/[orgId]/wallet/route";
import * as payRoute from "@/app/api/organizations/[orgId]/billing/invoices/[iid]/pay/route";
import * as paymentWebhook from "@/app/api/webhooks/payments/[gateway]/route";
import * as adminMarkPaid from "@/app/api/admin/invoices/[id]/mark-paid/route";

const SECRET = "topup-gateway-secret";
const sign = (b: string) => createHmac("sha256", SECRET).update(b).digest("hex");
let seq = 0;
const gateway: PaymentGateway = {
  id: "testpay",
  label: "TestPay",
  isConfigured: async () => true,
  createCheckout: async (r) => ({ kind: "client_sdk", gateway: "testpay", reference: `order_t${seq++}`, publicKey: "pk", amount: r.amount, currency: r.currency, name: "MECGURA", description: r.description, prefill: r.customer, mode: "test" }),
  parseWebhook: async (raw, headers) => {
    if (headers.get("x-sig") !== sign(raw)) throw new GatewayError("Invalid signature.", 401);
    const b = JSON.parse(raw) as { id: string; reference: string; paymentId: string; amount: number };
    return [{ eventId: b.id, type: "payment.succeeded", reference: b.reference, paymentId: b.paymentId, amount: b.amount, currency: "INR" }];
  },
};
const hook = (body: Record<string, unknown>) => {
  const raw = JSON.stringify(body);
  return paymentWebhook.POST(new Request("http://localhost:3000/api/webhooks/payments/testpay", { method: "POST", body: raw, headers: { "x-sig": sign(raw) } }), params({ gateway: "testpay" }));
};
afterEach(() => {
  unregisterGateway("testpay");
  vi.unstubAllEnvs();
});

let n = 0;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
async function tenant() {
  const org = await makeOrg(`Topup ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const manager = await makeUser({ name: "Manager" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, manager.id, "MANAGER");
  return { org, owner, manager };
}
const balance = async (orgId: string) => (await db.wallet.findUnique({ where: { organizationId: orgId } }))?.balance ?? 0;

describe("wallet top-up", () => {
  it("only the owner starts a top-up; amount limits are enforced", async () => {
    const t = await tenant();
    actAs(t.manager);
    expect((await topup.POST(req("/x", { method: "POST", body: { amountRupees: 500 } }), P(t.org.id))).status).toBe(403);
    actAs(t.owner);
    for (const bad of [{ amountRupees: 50 }, { amountRupees: 60_000 }, { amountRupees: 100.123 }, { amountRupees: 500, extra: 1 }, {}]) {
      expect((await topup.POST(req("/x", { method: "POST", body: bad }), P(t.org.id))).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("credit is added once, only after a signed payment confirmation, for the pre-tax amount", async () => {
    registerGateway(gateway);
    const t = await tenant();
    actAs(t.owner);
    const made = await json(await topup.POST(req("/x", { method: "POST", body: { amountRupees: 1000 } }), P(t.org.id)));
    expect(made.status).toBe(201);
    const inv = made.body.invoice as { id: string; kind: string; subtotal: number; total: number; status: string };
    expect(inv).toMatchObject({ kind: "topup", subtotal: 100_000, status: "open" });
    expect(await balance(t.org.id)).toBe(0); // issuing the invoice credits nothing
    const start = await json(await payRoute.POST(req("/x", { method: "POST", body: { gateway: "testpay" } }), P(t.org.id, { iid: inv.id })));
    const ref = (start.body.checkout as { reference: string }).reference;
    // Wrong amount: refused.
    await hook({ id: "w1", reference: ref, paymentId: "p1", amount: inv.total - 1 });
    expect(await balance(t.org.id)).toBe(0);
    // Right amount: credited; a repeat of the same or a new event adds nothing more.
    await hook({ id: "w2", reference: ref, paymentId: "p2", amount: inv.total });
    expect(await balance(t.org.id)).toBe(100_000);
    await hook({ id: "w2", reference: ref, paymentId: "p2", amount: inv.total });
    await hook({ id: "w3", reference: ref, paymentId: "p3", amount: inv.total });
    expect(await balance(t.org.id)).toBe(100_000);
    const w = await json(await walletRoute.GET(req("/x"), P(t.org.id)));
    const entries = (w.body.entries ?? (w.body.wallet as { entries?: unknown[] })?.entries ?? []) as { reason: string }[];
    expect(entries.filter((e) => e.reason === "topup").length).toBeLessThanOrEqual(1);
  });

  it("an admin recording a bank transfer on a top-up invoice also credits the wallet once", async () => {
    const t = await tenant();
    const admin = await makeUser({ role: "SUPER_ADMIN", name: "Admin" });
    actAs(t.owner);
    const inv = (await json(await topup.POST(req("/x", { method: "POST", body: { amountRupees: 250 } }), P(t.org.id)))).body.invoice as { id: string };
    actAs(admin);
    expect((await adminMarkPaid.POST(req("/x", { method: "POST", body: { reference: "UTR12345" } }), params({ id: inv.id }))).status).toBe(200);
    expect(await balance(t.org.id)).toBe(25_000);
    expect((await adminMarkPaid.POST(req("/x", { method: "POST", body: { reference: "UTR12345" } }), params({ id: inv.id }))).status).toBe(409);
    expect(await balance(t.org.id)).toBe(25_000);
  });

  it("limits unpaid top-up invoices", async () => {
    const t = await tenant();
    actAs(t.owner);
    for (let i = 0; i < 5; i++) expect((await topup.POST(req("/x", { method: "POST", body: { amountRupees: 100 } }), P(t.org.id))).status).toBe(201);
    expect((await topup.POST(req("/x", { method: "POST", body: { amountRupees: 100 } }), P(t.org.id))).status).toBe(409);
  });
});
