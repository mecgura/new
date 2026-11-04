import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import * as overviewRoute from "@/app/api/organizations/[orgId]/loyalty/route";
import * as settingsRoute from "@/app/api/organizations/[orgId]/loyalty/settings/route";
import * as purchasesRoute from "@/app/api/organizations/[orgId]/loyalty/purchases/route";
import * as redeemRoute from "@/app/api/organizations/[orgId]/loyalty/redeem/route";
import * as adjustRoute from "@/app/api/organizations/[orgId]/loyalty/adjust/route";
import * as rewardsRoute from "@/app/api/organizations/[orgId]/loyalty/rewards/route";
import * as customerRoute from "@/app/api/organizations/[orgId]/loyalty/customers/[contactId]/route";
import * as referralsRoute from "@/app/api/organizations/[orgId]/loyalty/referrals/route";
import * as referralRoute from "@/app/api/organizations/[orgId]/loyalty/referrals/[id]/route";
import * as membersRoute from "@/app/api/organizations/[orgId]/loyalty/members/route";
import * as linkRoute from "@/app/r/[org]/[code]/route";
import { balanceOf, codeInText, DEFAULT_LOYALTY, tierFor } from "@/lib/loyalty";
import { receiveInbound } from "@/services/inbox/messaging";

type U = Awaited<ReturnType<typeof makeUser>>;
let orgId: string;
let owner: U, agent: U;
let acctId: string;
let seq = 0;
const phone = () => `+9196${Date.now().toString().slice(-6)}${String(seq++).padStart(2, "0")}`;
const P = () => params({ orgId });
const post = (b: unknown) => req("/x", { method: "POST", body: b });
const put = (b: unknown) => req("/x", { method: "PUT", body: b });
const contact = async (name: string) => (await db.contact.create({ data: { organizationId: orgId, phone: phone(), name } })).id;

beforeAll(async () => {
  orgId = (await makeOrg("Loyal Bakery")).id;
  [owner, agent] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
  acctId = (await db.whatsAppAccount.create({ data: { organizationId: orgId, displayName: "Bakery", phoneNumber: "+919800011122", status: "demo", isDemo: true } })).id;
});

describe("loyalty maths", () => {
  it("redemptions use the oldest points first and leftover points expire", () => {
    const d = (day: number) => new Date(Date.UTC(2026, 0, day));
    const entries = [
      { points: 100, status: "approved", createdAt: d(1), expiresAt: d(31) },
      { points: 50, status: "approved", createdAt: d(10), expiresAt: d(60) },
      { points: -80, status: "approved", createdAt: d(20), expiresAt: null },
      { points: 500, status: "pending", createdAt: d(21), expiresAt: null },
    ];
    // Day 25: 20 left of the first batch + 50 = 70.
    expect(balanceOf(entries, d(25))).toMatchObject({ balance: 70, lifetime: 150 });
    // Day 40: the first batch's last 20 expired.
    expect(balanceOf(entries, d(40))).toMatchObject({ balance: 50, expired: 20 });
    expect(tierFor(1200, DEFAULT_LOYALTY.tiers)).toEqual({ tier: "Gold", next: { name: "Platinum", pointsToGo: 3800 } });
    expect(codeInText("hi, my code is ref-k7m2qx thanks")).toBe("K7M2QX");
    expect(codeInText("my reference is ABC")).toBeNull();
    expect(codeInText("REFERENCE NUMBER")).toBeNull();
  });
});

describe("referral & loyalty service", () => {
  it("is locked until MECGURA enables the service", async () => {
    actAs(owner);
    expect((await overviewRoute.GET(req("/x"), P())).status).toBe(403);
    await db.organizationService.create({ data: { organizationId: orgId, service: "LOYALTY", enabled: true } });
    expect((await overviewRoute.GET(req("/x"), P())).status).toBe(200);
  });

  it("purchases need the programme on; then earn points and make the contact a customer", async () => {
    actAs(owner);
    const c = await contact("Harpreet");
    expect((await purchasesRoute.POST(post({ contactId: c, amountRupees: 1000 }), P())).status).toBe(409);
    actAs(agent);
    expect((await settingsRoute.PUT(put({ ...DEFAULT_LOYALTY, enabled: true }), P())).status).toBe(403);
    actAs(owner);
    expect((await settingsRoute.PUT(put({ ...DEFAULT_LOYALTY, enabled: true, tiers: [{ name: "A", minPoints: 10 }, { name: "B", minPoints: 5 }] }), P())).status).toBe(400);
    expect((await settingsRoute.PUT(put({ ...DEFAULT_LOYALTY, enabled: true, welcomePoints: 20 }), P())).status).toBe(200);
    actAs(agent);
    const r = await json(await purchasesRoute.POST(post({ contactId: c, amountRupees: 2500, note: "Birthday cake" }), P()));
    expect(r.status).toBe(201);
    // 5 points per ₹100 → 125, plus 20 welcome on the first purchase.
    expect(r.body).toMatchObject({ points: 125, wallet: { balance: 145, tier: "Silver" } });
    expect((await db.contact.findUniqueOrThrow({ where: { id: c } })).lifecycle).toBe("customer");
    await purchasesRoute.POST(post({ contactId: c, amountRupees: 500 }), P());
    const card = await json(await customerRoute.GET(req("/x"), params({ orgId, contactId: c })));
    expect(card.body).toMatchObject({ lifetimeValueRupees: 3000, purchaseCount: 2, wallet: { balance: 170 } });
    expect(String((card.body.referral as { link: string }).link)).toMatch(new RegExp(`/r/${orgId}/[A-Z2-9]{6}$`));
  });

  it("redeems rewards, can't overdraw, and only managers adjust", async () => {
    actAs(owner);
    const c = await contact("Simran");
    await purchasesRoute.POST(post({ contactId: c, amountRupees: 2000 }), P()); // 100 points + 20 welcome
    const reward = (await json(await rewardsRoute.POST(post({ name: "Free pastry", points: 80 }), P()))).body.reward as { id: string };
    actAs(agent);
    expect((await rewardsRoute.POST(post({ name: "X", points: 1 }), P())).status).toBe(403);
    const ok1 = await json(await redeemRoute.POST(post({ contactId: c, rewardId: reward.id }), P()));
    expect(ok1.body.wallet).toMatchObject({ balance: 40 });
    expect((await redeemRoute.POST(post({ contactId: c, rewardId: reward.id }), P())).status).toBe(409);
    expect((await adjustRoute.POST(post({ contactId: c, points: 50, note: "Goodwill" }), P())).status).toBe(403);
    actAs(owner);
    expect((await adjustRoute.POST(post({ contactId: c, points: -100, note: "Mistake" }), P())).status).toBe(409);
    expect((await json(await adjustRoute.POST(post({ contactId: c, points: 60, note: "Goodwill" }), P()))).body.wallet).toMatchObject({ balance: 100 });
  });

  it("a referral link opens WhatsApp with the code; the friend's first message records the referral and their purchase pays it after approval", async () => {
    actAs(owner);
    const referrer = await contact("Aman");
    const card = await json(await customerRoute.GET(req("/x"), params({ orgId, contactId: referrer })));
    const { code, message } = card.body.referral as { code: string; message: string };
    const link = await linkRoute.GET(new Request(`http://localhost:3000/r/${orgId}/${code}`, { headers: { "x-forwarded-for": "198.51.100.40" } }), { params: Promise.resolve({ org: orgId, code }) });
    expect(link.status).toBe(302);
    expect(link.headers.get("location")).toContain("wa.me/919800011122");
    expect(decodeURIComponent(link.headers.get("location") ?? "")).toContain(`REF-${code}`);
    expect((await linkRoute.GET(new Request(`http://localhost:3000/r/${orgId}/ZZZZZZ`), { params: Promise.resolve({ org: orgId, code: "ZZZZZZ" }) })).status).toBe(404);

    // The friend messages for the first time with the pre-filled text.
    const friendPhone = phone();
    await receiveInbound(orgId, acctId, { externalId: `wamid.ref.${Date.now()}`, fromPhone: friendPhone, profileName: "Neha", type: "text", body: message, at: new Date(), isDemo: true });
    const friend = await db.contact.findFirstOrThrow({ where: { organizationId: orgId, phone: friendPhone } });
    const ref = await db.referral.findFirstOrThrow({ where: { refereeContactId: friend.id } });
    expect(ref).toMatchObject({ referrerContactId: referrer, status: "pending", flag: "" });

    // A small purchase doesn't qualify; ₹600 does, and waits for approval (manual by default).
    await purchasesRoute.POST(post({ contactId: friend.id, amountRupees: 100 }), P());
    expect((await db.referral.findUniqueOrThrow({ where: { id: ref.id } })).status).toBe("pending");
    const r = await json(await purchasesRoute.POST(post({ contactId: friend.id, amountRupees: 600 }), P()));
    expect(r.body.referral).toBe("waiting_approval");
    const pendingCard = await json(await customerRoute.GET(req("/x"), params({ orgId, contactId: referrer })));
    expect(pendingCard.body.wallet).toMatchObject({ balance: 0, pending: 100 });

    actAs(agent);
    expect((await referralRoute.POST(post({ decision: "approve" }), params({ orgId, id: ref.id }))).status).toBe(403);
    actAs(owner);
    expect((await referralRoute.POST(post({ decision: "approve" }), params({ orgId, id: ref.id }))).status).toBe(200);
    expect((await json(await customerRoute.GET(req("/x"), params({ orgId, contactId: referrer })))).body.wallet).toMatchObject({ balance: 100, pending: 0 });
    expect((await referralRoute.POST(post({ decision: "reject" }), params({ orgId, id: ref.id }))).status).toBe(409);
    const list = await json(await referralsRoute.GET(req("/x?status=rewarded"), P()));
    expect((list.body.referrals as { id: string }[]).map((x) => x.id)).toContain(ref.id);
  });

  it("flags referrals from people who were already customers, and never pays your own code", async () => {
    actAs(owner);
    const referrer = await contact("Rohit");
    const { code } = (await json(await customerRoute.GET(req("/x"), params({ orgId, contactId: referrer })))).body.referral as { code: string };
    // Own code: ignored.
    const own = await db.contact.findUniqueOrThrow({ where: { id: referrer } });
    await receiveInbound(orgId, acctId, { externalId: `wamid.own.${Date.now()}`, fromPhone: own.phone, profileName: "Rohit", type: "text", body: `REF-${code}`, at: new Date(), isDemo: true });
    expect(await db.referral.count({ where: { refereeContactId: referrer } })).toBe(0);
    // An old contact (created a day ago) using a code is flagged, and auto-approval doesn't pay it.
    const oldPhone = phone();
    await db.contact.create({ data: { organizationId: orgId, phone: oldPhone, name: "Old customer", createdAt: new Date(Date.now() - 86_400_000) } });
    await receiveInbound(orgId, acctId, { externalId: `wamid.old.${Date.now()}`, fromPhone: oldPhone, profileName: "Old", type: "text", body: `Hi REF ${code}`, at: new Date(), isDemo: true });
    const old = await db.contact.findFirstOrThrow({ where: { organizationId: orgId, phone: oldPhone } });
    const ref = await db.referral.findFirstOrThrow({ where: { refereeContactId: old.id } });
    expect(ref.flag).toContain("already a contact");
    await settingsRoute.PUT(put({ ...DEFAULT_LOYALTY, enabled: true, referralApproval: "auto" }), P());
    const r = await json(await purchasesRoute.POST(post({ contactId: old.id, amountRupees: 1000 }), P()));
    expect(r.body.referral).toBe("waiting_approval");
    const ov = await json(await overviewRoute.GET(req("/x"), P()));
    expect(ov.body).toMatchObject({ enabled: true, flagged: 1 });
    expect((ov.body.members as number) >= 4).toBe(true);
    const members = await json(await membersRoute.GET(req("/x?q=Harpreet"), P()));
    expect((members.body.members as { name: string; tier: string }[])[0]).toMatchObject({ name: "Harpreet", tier: "Silver" });
  });

  it("another workspace can't read these customers", async () => {
    const other = (await makeOrg("Other")).id;
    const stranger = await makeUser({ name: "Stranger" });
    await addMember(other, stranger.id, "CLIENT_OWNER");
    await db.organizationService.create({ data: { organizationId: other, service: "LOYALTY", enabled: true } });
    const c = await contact("Private");
    actAs(stranger);
    expect((await customerRoute.GET(req("/x"), params({ orgId: other, contactId: c }))).status).toBe(400);
    expect((await customerRoute.GET(req("/x"), params({ orgId, contactId: c }))).status).toBe(403);
  });
});
