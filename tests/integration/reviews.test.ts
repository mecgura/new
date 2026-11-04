import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import * as statsRoute from "@/app/api/organizations/[orgId]/reviews/route";
import * as requestsRoute from "@/app/api/organizations/[orgId]/reviews/requests/route";
import * as resolveRoute from "@/app/api/organizations/[orgId]/reviews/requests/[id]/resolve/route";
import * as settingsRoute from "@/app/api/organizations/[orgId]/reviews/settings/route";
import * as rateRoute from "@/app/api/f/[token]/route";
import * as googleRoute from "@/app/api/f/[token]/google/route";
import { DEFAULT_REVIEW_SETTINGS, openFeedback } from "@/services/reviews/reviews";

type U = Awaited<ReturnType<typeof makeUser>>;
let orgId: string;
let owner: U, agent: U;
let acctId: string;
let seq = 0;
const phone = () => `+9195${Date.now().toString().slice(-6)}${String(seq++).padStart(2, "0")}`;
const P = () => params({ orgId });
const post = (b: unknown) => req("/x", { method: "POST", body: b });
const tokenOf = (link: string) => link.split("/f/")[1];
const rate = (token: string, b: unknown) => rateRoute.POST(new Request(`http://localhost:3000/api/f/${token}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${seq++ % 200}` }, body: JSON.stringify(b) }), { params: Promise.resolve({ token }) });

/** A contact who messaged in the last hour (WhatsApp window open). */
async function chattingContact(name: string) {
  const c = await db.contact.create({ data: { organizationId: orgId, phone: phone(), name, optInStatus: "opted_in", lastInboundAt: new Date() } });
  await db.conversation.create({ data: { organizationId: orgId, contactId: c.id, whatsappAccountId: acctId, isDemo: true, lastInboundAt: new Date(Date.now() - 3_600_000) } });
  return c.id;
}

beforeAll(async () => {
  orgId = (await makeOrg("Glow Salon")).id;
  [owner, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
  acctId = (await db.whatsAppAccount.create({ data: { organizationId: orgId, displayName: "Glow", phoneNumber: "+919800033344", status: "demo", isDemo: true } })).id;
});

describe("reviews & reputation", () => {
  it("is locked until enabled, and only managers change settings", async () => {
    actAs(owner);
    expect((await statsRoute.GET(req("/x"), P())).status).toBe(403);
    await db.organizationService.create({ data: { organizationId: orgId, service: "REVIEWS", enabled: true } });
    expect((await statsRoute.GET(req("/x"), P())).status).toBe(200);
    const settings = { ...DEFAULT_REVIEW_SETTINGS, locations: [{ name: "Model Town", reviewUrl: "https://g.page/r/glow-mt/review" }, { name: "Sarabha Nagar", reviewUrl: "" }] };
    actAs(agent);
    expect((await settingsRoute.PUT(req("/x", { method: "PUT", body: settings }), P())).status).toBe(403);
    actAs(owner);
    expect((await settingsRoute.PUT(req("/x", { method: "PUT", body: { ...settings, message: "Please rate us soon thanks a lot" } }), P())).status).toBe(400);
    expect((await settingsRoute.PUT(req("/x", { method: "PUT", body: { ...settings, locations: [{ name: "A", reviewUrl: "http://insecure" }] } }), P())).status).toBe(400);
    expect((await settingsRoute.PUT(req("/x", { method: "PUT", body: settings }), P())).status).toBe(200);
  });

  it("sends in the open chat window, skips the cooldown and closed windows without a template", async () => {
    actAs(agent);
    const happy = await chattingContact("Simran Kaur");
    const cold = (await db.contact.create({ data: { organizationId: orgId, phone: phone(), name: "Old Customer", optInStatus: "opted_in" } })).id;
    const r = await json(await requestsRoute.POST(post({ contactIds: [happy, cold], location: "Model Town" }), P()));
    expect(r.status).toBe(200);
    const res = r.body.results as { contactId: string; status: string; reason?: string; link?: string }[];
    expect(res.find((x) => x.contactId === happy)).toMatchObject({ status: "sent" });
    expect(res.find((x) => x.contactId === cold)).toMatchObject({ status: "failed" });
    expect(res.find((x) => x.contactId === cold)?.reason).toContain("24-hour window");
    // The message went into the chat with the link and first name.
    const msg = await db.message.findFirst({ where: { organizationId: orgId, direction: "outbound" }, orderBy: { createdAt: "desc" } });
    expect(msg?.body).toContain("Hi Simran");
    expect(msg?.body).toContain("/f/");
    // Asked again within 30 days: skipped. Unknown location: refused. Link-only works for anyone.
    const again = await json(await requestsRoute.POST(post({ contactIds: [happy] }), P()));
    expect((again.body.results as { status: string }[])[0].status).toBe("skipped");
    expect((await requestsRoute.POST(post({ contactIds: [happy], location: "Nowhere" }), P())).status).toBe(400);
    const links = await json(await requestsRoute.POST(post({ contactIds: [cold], linkOnly: true }), P()));
    expect((links.body.results as { status: string; link: string }[])[0]).toMatchObject({ status: "link" });
  });

  it("customer rates on the public page: low ratings alert the team and tag them; everyone gets the Google link", async () => {
    actAs(agent);
    const sad = await chattingContact("Rohit Sharma");
    const glad = await chattingContact("Neha Arora");
    const out = (await json(await requestsRoute.POST(post({ contactIds: [sad, glad], location: "Model Town" }), P()))).body.results as { contactId: string; link: string }[];
    const sadToken = tokenOf(out.find((x) => x.contactId === sad)!.link);
    const gladToken = tokenOf(out.find((x) => x.contactId === glad)!.link);

    expect(await openFeedback(sadToken)).toMatchObject({ business: "Glow Salon", firstName: "Rohit", reviewUrl: "https://g.page/r/glow-mt/review" });
    expect(await openFeedback("nope")).toBeNull();
    expect((await rate(sadToken, { rating: 9 })).status).toBe(400);
    const low = await json(await rate(sadToken, { rating: 2, comment: "Waited 40 minutes" }));
    expect(low.body).toMatchObject({ low: true, reviewUrl: "https://g.page/r/glow-mt/review" });
    expect((await rate(sadToken, { rating: 5 })).status).toBe(409);
    expect(await db.notification.count({ where: { userId: owner.id, title: { contains: "2★" } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: agent.id, title: { contains: "2★" } } })).toBe(0);
    expect((await db.contactTag.findMany({ where: { contactId: sad }, include: { tag: true } })).map((t) => t.tag.name)).toContain("Unhappy customer");

    const high = await json(await rate(gladToken, { rating: 5 }));
    expect(high.body).toMatchObject({ low: false, reviewUrl: "https://g.page/r/glow-mt/review" });
    const g = await googleRoute.GET(new Request("http://localhost:3000/x"), { params: Promise.resolve({ token: gladToken }) });
    expect(g.status).toBe(302);
    expect(g.headers.get("location")).toBe("https://g.page/r/glow-mt/review");

    // Team: resolve the unhappy one (managers only), stats add up.
    const open = await json(await requestsRoute.GET(req("/x?filter=open"), P()));
    const issue = (open.body.requests as { id: string; contact: { id: string } }[]).find((x) => x.contact.id === sad)!;
    expect((await resolveRoute.POST(post({ note: "Called, gave a free spa" }), params({ orgId, id: issue.id }))).status).toBe(403);
    actAs(owner);
    expect((await resolveRoute.POST(post({ note: "Called, gave a free spa" }), params({ orgId, id: issue.id }))).status).toBe(200);
    const stats = await json(await statsRoute.GET(req("/x"), P()));
    expect(stats.body).toMatchObject({ average: 3.5, openIssues: 0, googleClickRate: 50 });
    expect((stats.body.locations as { name: string; rated: number }[]).find((l) => l.name === "Model Town")).toMatchObject({ rated: 2 });
  });

  it("another workspace can't list or resolve these", async () => {
    const other = (await makeOrg("Other")).id;
    const stranger = await makeUser({ name: "Stranger" });
    await addMember(other, stranger.id, "CLIENT_OWNER");
    await db.organizationService.create({ data: { organizationId: other, service: "REVIEWS", enabled: true } });
    const any = await db.reviewRequest.findFirstOrThrow({ where: { organizationId: orgId } });
    actAs(stranger);
    expect((await requestsRoute.GET(req("/x"), P())).status).toBe(403);
    expect((await resolveRoute.POST(post({ note: "hijack" }), params({ orgId: other, id: any.id }))).status).toBe(404);
    expect((await requestsRoute.POST(post({ contactIds: [any.contactId] }), params({ orgId: other }))).status).toBe(400);
  });
});
