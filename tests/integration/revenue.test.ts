import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { actAs, json, makeOrg, makePlan, makeUser, req } from "../helpers";
import * as revenueRoute from "@/app/api/admin/revenue/route";
import * as csvRoute from "@/app/api/admin/revenue/csv/route";
import { monthWindows, movement, mrrByOrg } from "@/services/billing/revenue";

const D = (s: string) => new Date(`${s}T12:00:00Z`);

describe("revenue maths", () => {
  it("MRR per client at a moment, and how it moved", () => {
    const sub = (organizationId: string, priceMonthly: number, startedAt: string, endedAt: string | null, orgActive = true) => ({ organizationId, priceMonthly, startedAt: D(startedAt), endedAt: endedAt ? D(endedAt) : null, endReason: "", planId: "p", orgActive });
    const subs = [
      sub("a", 1000, "2026-01-01", "2026-03-10"), // a upgrades on 10 Mar
      sub("a", 2500, "2026-03-10", null),
      sub("b", 3000, "2026-01-01", "2026-03-20"), // b cancels
      sub("c", 2000, "2026-03-05", null), // c is new
      sub("d", 4000, "2026-01-01", "2026-03-15"), // d downgrades
      sub("d", 1500, "2026-03-15", null),
      sub("e", 9000, "2026-01-01", null, false), // suspended client never counts
    ];
    const before = mrrByOrg(subs, D("2026-02-28"));
    const after = mrrByOrg(subs, D("2026-03-31"));
    expect([...before.values()].reduce((a, b) => a + b, 0)).toBe(8000);
    expect([...after.values()].reduce((a, b) => a + b, 0)).toBe(6000);
    expect(movement(before, after)).toEqual({ added: 2000, expansion: 1500, contraction: 2500, churned: 3000, newClients: 1, lostClients: 1 });
    const w = monthWindows(12, new Date("2026-11-04T10:00:00Z"));
    expect(w).toHaveLength(12);
    expect(w.at(-1)!.month).toBe("2026-11");
    expect(w[0].month).toBe("2025-12");
    // IST month start = 18:30 UTC of the previous day.
    expect(w.at(-1)!.start.toISOString()).toBe("2026-10-31T18:30:00.000Z");
  });
});

describe("revenue dashboard", () => {
  it("only the Super Admin sees it; shows the client's MRR, payments, plan and reconciliation problems; CSV is safe", async () => {
    const admin = await makeUser({ role: "SUPER_ADMIN", name: "Admin" });
    actAs(await makeUser({ name: "Client" }));
    expect((await revenueRoute.GET(req("/x"))).status).toBe(403);
    expect((await csvRoute.GET(req("/x"))).status).toBe(403);

    const org = await makeOrg("=HYPERLINK Bakery");
    const plan = await makePlan({ name: `Growth ${Date.now()}`, priceMonthly: 499900 });
    await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: 499900, startedAt: new Date(Date.now() - 40 * 86_400_000), billingMode: "invoiced" } });
    const inv = await db.invoice.create({ data: { organizationId: org.id, number: `INV-T-${Date.now()}`, status: "open", total: 589882, subtotal: 499900, dueAt: new Date(), kind: "renewal" } });
    await db.payment.create({ data: { organizationId: org.id, invoiceId: inv.id, gateway: "razorpay", amount: 589882, status: "succeeded" } });
    await db.invoice.create({ data: { organizationId: org.id, number: `INV-P-${Date.now()}`, status: "paid", paidAt: new Date(), total: 589882, subtotal: 499900, dueAt: new Date(), kind: "subscription", paidVia: "manual" } });

    actAs(admin);
    const r = await json(await revenueRoute.GET(req("/x")));
    expect(r.status).toBe(200);
    expect(r.body.arr).toBe((r.body.mrr as number) * 12);
    const client = (r.body.clients as { id: string; mrr: number; paid12m: number }[]).find((c) => c.id === org.id);
    expect(client).toMatchObject({ mrr: 499900, paid12m: 589882 });
    expect((r.body.byPlan as { id: string; mrr: number; clients: number }[]).find((p) => p.id === plan.id)).toMatchObject({ mrr: 499900, clients: 1 });
    const mismatch = (r.body.reconciliation as { mismatches: { invoice: string; kind: string }[] }).mismatches.find((m) => m.invoice === inv.number);
    expect(mismatch?.kind).toBe("Payment received, invoice not paid");
    expect((r.body.trend as unknown[]).length).toBe(12);

    const csv = await csvRoute.GET(req("/x"));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain(`"'=HYPERLINK Bakery",4999.00,5898.82,1`);
  });
});
