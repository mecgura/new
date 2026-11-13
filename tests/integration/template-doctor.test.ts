import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as templates from "@/app/api/organizations/[orgId]/templates/route";
import * as submit from "@/app/api/organizations/[orgId]/templates/[tid]/submit/route";
import * as review from "@/app/api/organizations/[orgId]/templates/[tid]/review/route";
import * as doctor from "@/app/api/organizations/[orgId]/templates/[tid]/doctor/route";

const post = (body: unknown) => req("/x", { method: "POST", body });

describe("template doctor route", () => {
  it("explains a rejection and makes a fixed draft under a new name", async () => {
    const org = await makeOrg("Doctor");
    const owner = await makeUser({ name: "Owner" });
    const agent = await makeUser({ name: "Agent" });
    await addMember(org.id, owner.id, "CLIENT_OWNER");
    await addMember(org.id, agent.id, "AGENT");
    const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
    await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
    await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
    actAs(owner);
    const P = params({ orgId: org.id });
    const acc = (await json(await demoConnect.POST(post({ businessName: "Doctor" }), P))).body.account as { id: string };
    const acct = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: acc.id } });
    const t = await json(await templates.POST(post({ wabaId: acct.wabaRecordId, name: "cake_offer", language: "en", category: "UTILITY", body: "Diwali sale is live. Get 20% off on all cakes today only. Reply STOP to unsubscribe." }), P));
    expect(t.status).toBe(201);
    const tid = (t.body.template as { id: string }).id;
    const T = { params: Promise.resolve({ orgId: org.id, tid }) };
    await submit.POST(post({}), T);

    // Not rejected yet: nothing to fix.
    expect((await json(await doctor.POST(post({}), T))).status).toBe(409);
    await review.POST(post({ decision: "rejected", reason: "INCORRECT_CATEGORY" }), T);

    const d = await json(await doctor.GET(req("/x"), T));
    expect(d.body.title).toBe("Wrong category");
    actAs(agent);
    expect((await json(await doctor.POST(post({}), T))).status).toBe(403);
    actAs(owner);
    const f = await json(await doctor.POST(post({}), T));
    expect(f.status).toBe(201);
    const copy = f.body.template as { name: string; category: string; status: string };
    expect(copy).toMatchObject({ name: "cake_offer_v2", category: "MARKETING", status: "draft" });
    const again = await json(await doctor.POST(post({}), T));
    expect((again.body.template as { name: string }).name).toBe("cake_offer_v3");
  });
});
