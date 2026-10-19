import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as calls from "@/app/api/organizations/[orgId]/voice/calls/route";
import * as call from "@/app/api/organizations/[orgId]/voice/calls/[callId]/route";

let n = 0;
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
const post = (body: unknown) => req("/x", { method: "POST", body });

async function tenant() {
  const org = await makeOrg(`Voice ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 20 });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  const contact = await db.contact.create({ data: { organizationId: org.id, phone: `+9198${String(Date.now()).slice(-8)}`, name: "Asha" } });
  return { org, owner, agent, contact };
}
const body = (contactId: string, over: Record<string, unknown> = {}) => ({ contactId, goal: "Confirm the appointment", consentNote: "Asked for a call on the enquiry form", ...over });

describe("AI calling (practice mode)", () => {
  it("records a clearly-labelled practice call with transcript and summary; nobody is dialled", async () => {
    const t = await tenant();
    actAs(t.owner);
    const r = await json(await calls.POST(post(body(t.contact.id)), P(t.org.id)));
    expect(r.status).toBe(201);
    const c = r.body.call as { mode: string; status: string; summary: string; transcript: unknown[]; contact: { id: string } };
    expect(c.mode).toBe("demo");
    expect(c.summary).toMatch(/Practice call/);
    expect(c.contact.id).toBe(t.contact.id);
    const list = await json(await calls.GET(req("/x"), P(t.org.id)));
    expect((list.body.status as { live: boolean }).live).toBe(false);
    expect((list.body.calls as unknown[]).length).toBe(1);
  });

  it("requires consent text, refuses opted-out / suppressed / foreign contacts, rejects unknown fields", async () => {
    const t = await tenant();
    const other = await tenant();
    actAs(t.owner);
    expect((await calls.POST(post(body(t.contact.id, { consentNote: "" })), P(t.org.id))).status).toBe(400);
    expect((await calls.POST(post(body(t.contact.id, { mode: "live" })), P(t.org.id))).status).toBe(400);
    expect((await calls.POST(post(body(other.contact.id)), P(t.org.id))).status).toBe(404);
    await db.contact.update({ where: { id: t.contact.id }, data: { optInStatus: "opted_out" } });
    expect((await calls.POST(post(body(t.contact.id)), P(t.org.id))).status).toBe(409);
    await db.contact.update({ where: { id: t.contact.id }, data: { optInStatus: "unknown", suppressed: true } });
    expect((await calls.POST(post(body(t.contact.id)), P(t.org.id))).status).toBe(409);
  });

  it("agents can view but not place calls; calls are tenant-isolated", async () => {
    const t = await tenant();
    const other = await tenant();
    actAs(t.owner);
    const made = await json(await calls.POST(post(body(t.contact.id)), P(t.org.id)));
    const id = (made.body.call as { id: string }).id;
    actAs(t.agent);
    expect((await calls.POST(post(body(t.contact.id)), P(t.org.id))).status).toBe(403);
    expect((await call.GET(req("/x"), P(t.org.id, { callId: id }))).status).toBe(200);
    actAs(other.owner);
    expect((await call.GET(req("/x"), P(other.org.id, { callId: id }))).status).toBe(404);
    expect(((await json(await calls.GET(req("/x"), P(other.org.id)))).body.calls as unknown[]).length).toBe(0);
  });
});
