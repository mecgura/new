import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makePlan, makeUser, params, req } from "../helpers";
import * as demoConnect from "@/app/api/organizations/[orgId]/whatsapp/connect/demo/route";
import * as automations from "@/app/api/organizations/[orgId]/automations/route";
import * as library from "@/app/api/organizations/[orgId]/automations/library/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/automations/[aid]/publish/route";
import { AUTOMATION_LIBRARY } from "@/lib/automation-library";
import { validateGraph } from "@/lib/automations";

const post = (body: unknown) => req("/x", { method: "POST", body });
const P = <E extends Record<string, string> = Record<never, string>>(orgId: string, extra?: E) => params({ orgId, ...(extra ?? ({} as E)) });
let orgId: string;
let owner: Awaited<ReturnType<typeof makeUser>>;
let agent: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  orgId = (await makeOrg("Library Shop")).id;
  [owner, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
  const plan = await makePlan({ maxUsers: 5, maxWhatsAppNumbers: 2 });
  await db.subscription.create({ data: { organizationId: orgId, planId: plan.id, priceMonthly: plan.priceMonthly } });
  await db.organizationService.create({ data: { organizationId: orgId, service: "WHATSAPP_AUTOMATION", enabled: true } });
  actAs(owner);
  await demoConnect.POST(post({ businessName: "Library Shop" }), P(orgId));
});

describe("ready-made automations", () => {
  it("every template is a valid graph with unique ids", () => {
    for (const t of AUTOMATION_LIBRARY) {
      const g = t.graph();
      expect(validateGraph(g).errors, t.id).toEqual([]);
      expect(new Set(g.nodes.map((n) => n.id)).size, t.id).toBe(g.nodes.length);
    }
    // The long conversation really is long, and saves the answers on the contact.
    const lq = AUTOMATION_LIBRARY.find((t) => t.id === "lead_qualification")!.graph();
    expect(lq.nodes.length).toBeGreaterThanOrEqual(20);
    expect(lq.nodes.filter((n) => n.type === "update_contact").length).toBeGreaterThanOrEqual(5);
  });

  it("long flows are locked until the Ready-made automations add-on is on", async () => {
    actAs(agent);
    const list = await json(await library.GET(req("/x"), P(orgId)));
    expect(list.status).toBe(200);
    const items = list.body.templates as { id: string; locked: boolean; premium: boolean }[];
    expect(items.find((t) => t.id === "demo_welcome")).toMatchObject({ locked: false, premium: false });
    expect(items.filter((t) => t.premium).every((t) => t.locked)).toBe(true);

    actAs(owner);
    expect((await automations.POST(post({ name: "Qualify", start: "lead_qualification" }), P(orgId))).status).toBe(403);
    expect((await automations.POST(post({ name: "Welcome", start: "demo_welcome" }), P(orgId))).status).toBe(201);
    expect((await automations.POST(post({ name: "X", start: "nope" }), P(orgId))).status).toBe(400);
  });

  it("with the add-on, each long flow can be created, edited later and published", async () => {
    await db.organizationService.create({ data: { organizationId: orgId, service: "AUTOMATION_PACK", enabled: true } });
    actAs(owner);
    const items = (await json(await library.GET(req("/x"), P(orgId)))).body.templates as { id: string; locked: boolean }[];
    expect(items.every((t) => !t.locked)).toBe(true);
    for (const id of ["lead_qualification", "appointment_booking", "product_enquiry", "feedback"]) {
      const c = await json(await automations.POST(post({ name: id, start: id }), P(orgId)));
      expect(c.status, id).toBe(201);
      const aid = (c.body.automation as { id: string }).id;
      const pub = await json(await publishRoute.POST(post({ note: "v1" }), P(orgId, { aid })));
      expect(pub.status, `${id}: ${JSON.stringify(pub.body)}`).toBe(200);
    }
  });
});
