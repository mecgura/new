import { afterAll, describe, expect, it } from "vitest";
import { actAs, json, makeOrg, makeUser, params, req } from "../helpers";
import * as billingRoute from "@/app/api/admin/organizations/[id]/meta-billing/route";
import * as ratesRoute from "@/app/api/admin/meta-rates/route";
import * as clientsRoute from "@/app/api/admin/organizations/route";
import { makePlan } from "../helpers";
import { getMetaBilling } from "@/services/billing/meta-billing";
import { getPriceCard } from "@/services/wallet-pricing";
import { DEFAULT_META_RATES, saveMetaRates } from "@/services/meta-rates";

afterAll(async () => {
  await saveMetaRates(DEFAULT_META_RATES);
});

const put = (id: string, body: Record<string, unknown>) => billingRoute.PUT(req("/x", { method: "PUT", body }), params({ id }));

describe("meta billing type", () => {
  it("defaults to client pays; prepaid prices the wallet at Meta rate + markup; switching back clears it", async () => {
    const admin = await makeUser({ role: "SUPER_ADMIN" });
    const org = await makeOrg("Billing type");
    actAs(admin);
    await saveMetaRates({ marketing: 80, utility: 12, authentication: 12 });
    const g = await json(await billingRoute.GET(req("/x"), params({ id: org.id })));
    expect(g.body.billing).toEqual({ mode: "client_pays", markupPaise: 20 });

    expect((await put(org.id, { mode: "prepaid_wallet", markupRupees: 0.25 })).status).toBe(200);
    expect((await getPriceCard(org.id)).overrides).toMatchObject({ marketing: 105, utility: 37, authentication: 37 });

    // Changing Meta's rates re-prices prepaid clients.
    const r = await json(await ratesRoute.PUT(req("/x", { method: "PUT", body: { marketing: 90, utility: 12, authentication: 12 } }), params({})));
    expect(r.body.repriced).toBeGreaterThanOrEqual(1);
    expect((await getPriceCard(org.id)).overrides.marketing).toBe(115);

    expect((await put(org.id, { mode: "client_pays" })).status).toBe(200);
    expect((await getPriceCard(org.id)).overrides).toEqual({});
  });

  it("only a Super Admin can change it and bad input is rejected", async () => {
    const admin = await makeUser({ role: "SUPER_ADMIN" });
    const user = await makeUser();
    const org = await makeOrg("Billing guard");
    actAs(admin);
    expect((await put(org.id, { mode: "free" })).status).toBe(400);
    expect((await put(org.id, { mode: "prepaid_wallet", markupRupees: -1 })).status).toBe(400);
    actAs(user);
    expect((await put(org.id, { mode: "prepaid_wallet" })).status).toBe(403);
  });

  it("can be chosen when creating a client", async () => {
    const admin = await makeUser({ role: "SUPER_ADMIN" });
    const plan = await makePlan({ maxUsers: 3, maxWhatsAppNumbers: 1 });
    actAs(admin);
    await saveMetaRates({ marketing: 80, utility: 12, authentication: 12 });
    const r = await json(
      await clientsRoute.POST(
        req("/x", { method: "POST", body: { name: "Prepaid Shop", ownerName: "Ravi Kumar", ownerEmail: `prepaid${Date.now()}@example.com`, ownerPassword: "Str0ngPassw0rd!", planId: plan.id, metaBillingMode: "prepaid_wallet", markupRupees: 0.3 } }),
        params({})
      )
    );
    expect(r.status).toBe(201);
    const orgId = (r.body.organization as { id: string }).id;
    expect(await getMetaBilling(orgId)).toEqual({ mode: "prepaid_wallet", markupPaise: 30 });
    expect((await getPriceCard(orgId)).overrides.marketing).toBe(110);
  });
});
