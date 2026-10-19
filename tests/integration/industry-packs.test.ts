import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as packs from "@/app/api/organizations/[orgId]/industry-packs/route";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";

let n = 0;
const P = (orgId: string) => params({ orgId });
async function tenant(withNumber: boolean) {
  const org = await makeOrg(`Pack ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 20 });
  await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  if (withNumber) expect((await demoConnect.POST(req("/x", { method: "POST", body: { businessName: "Pack Store" } }), P(org.id))).status).toBe(201);
  return { org, owner, agent };
}
const apply = (orgId: string, packId: string) => packs.POST(req("/x", { method: "POST", body: { packId } }), P(orgId));

describe("industry packs", () => {
  it("lists packs; applies tags, a draft agent and template drafts; applying twice adds nothing", async () => {
    const t = await tenant(true);
    const list = await json(await packs.GET(req("/x"), P(t.org.id)));
    expect((list.body.packs as unknown[]).length).toBeGreaterThanOrEqual(4);
    const r = await json(await apply(t.org.id, "clinic"));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ tags: 3, templates: 2 });
    expect(await db.tag.count({ where: { organizationId: t.org.id } })).toBe(3);
    const agents = await db.aiAgent.findMany({ where: { organizationId: t.org.id } });
    // The agent is only created when the plan includes the AI agent; it is never activated.
    expect(agents.every((a) => a.status === "draft")).toBe(true);
    const templates = await db.messageTemplate.findMany({ where: { organizationId: t.org.id } });
    expect(templates).toHaveLength(2);
    expect(templates.every((x) => x.status === "draft")).toBe(true);
    const again = await json(await apply(t.org.id, "clinic"));
    expect(again.body).toMatchObject({ tags: 0, templates: 0 });
    expect(await db.messageTemplate.count({ where: { organizationId: t.org.id } })).toBe(2);
  });

  it("without a WhatsApp number it still adds tags and says why templates were skipped", async () => {
    const t = await tenant(false);
    const r = await json(await apply(t.org.id, "salon"));
    expect(r.body).toMatchObject({ tags: 3, templates: 0 });
    expect(String(r.body.templatesNote)).toMatch(/Connect a WhatsApp number/);
  });

  it("only owners apply packs; unknown packs and extra fields are rejected", async () => {
    const t = await tenant(true);
    actAs(t.agent);
    expect((await apply(t.org.id, "clinic")).status).toBe(403);
    actAs(t.owner);
    expect((await apply(t.org.id, "nope")).status).toBe(404);
    expect((await packs.POST(req("/x", { method: "POST", body: { packId: "clinic", extra: 1 } }), P(t.org.id))).status).toBe(400);
  });
});
