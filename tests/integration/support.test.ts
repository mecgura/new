import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/background", () => ({ runAfterResponse: vi.fn() }));

import { db } from "@/lib/db";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import * as clientList from "@/app/api/organizations/[orgId]/support/route";
import * as clientTicket from "@/app/api/organizations/[orgId]/support/[id]/route";
import * as clientResolve from "@/app/api/organizations/[orgId]/support/[id]/resolve/route";
import * as clientFile from "@/app/api/organizations/[orgId]/support/attachments/[aid]/route";
import * as adminList from "@/app/api/admin/support/route";
import * as adminTicket from "@/app/api/admin/support/[id]/route";
import * as adminFile from "@/app/api/admin/support/attachments/[aid]/route";
import * as healthRoute from "@/app/api/admin/health/route";
import { escalateBreaches, SLA_HOURS } from "@/services/support/tickets";
import { runHealthAlerts } from "@/services/admin/system-health";

type U = Awaited<ReturnType<typeof makeUser>>;
let orgId: string, otherOrg: string;
let owner: U, agent: U, stranger: U, admin: U;
const P = () => params({ orgId });
const post = (b: unknown) => req("/x", { method: "POST", body: b });
const PDF = `data:application/pdf;base64,${Buffer.from("%PDF-1.4\n%test\n").toString("base64")}`;
const FAKE_PNG = `data:image/png;base64,${Buffer.from("<html>not a png</html>").toString("base64")}`;

beforeAll(async () => {
  orgId = (await makeOrg("Help Me Shop")).id;
  otherOrg = (await makeOrg("Other Shop")).id;
  [owner, agent, stranger, admin] = await Promise.all([makeUser({ name: "Owner" }), makeUser({ name: "Agent" }), makeUser({ name: "Stranger" }), makeUser({ name: "Gurjeet", role: "SUPER_ADMIN" })]);
  await addMember(orgId, owner.id, "CLIENT_OWNER");
  await addMember(orgId, agent.id, "AGENT");
  await addMember(otherOrg, stranger.id, "CLIENT_OWNER");
});

describe("support desk", () => {
  let ticketId = "";
  let fileId = "";

  it("any team member opens a ticket with an attachment; the deadline follows priority and admins are told", async () => {
    actAs(agent);
    expect((await clientList.POST(post({ subject: "Hi", category: "billing", body: "short" }), P())).status).toBe(400);
    expect((await clientList.POST(post({ subject: "Campaign stuck on sending", category: "campaigns", priority: "high", body: "Started at 10am, still sending.", attachments: [{ filename: "x.png", data: FAKE_PNG }] }), P())).status).toBe(400);
    const before = Date.now();
    const r = await json(await clientList.POST(post({ subject: "Campaign stuck on sending", category: "campaigns", priority: "high", body: "Started at 10am, still sending.", attachments: [{ filename: "log.pdf", data: PDF }] }), P()));
    expect(r.status).toBe(201);
    const t = r.body.ticket as { id: string; number: number; status: string; slaDueAt: string; messages: { attachments: { id: string }[] }[] };
    ticketId = t.id;
    fileId = t.messages[0].attachments[0].id;
    expect(t.number).toBeGreaterThan(1000);
    expect(new Date(t.slaDueAt).getTime() - before).toBeGreaterThan(SLA_HOURS.high * 3_600_000 - 60_000);
    expect(await db.notification.count({ where: { userId: admin.id, title: { contains: `#${t.number}` } } })).toBe(1);
    const file = await clientFile.GET(req("/x"), params({ orgId, aid: fileId }));
    expect(file.headers.get("content-type")).toBe("application/pdf");
  });

  it("admins reply and add internal notes; clients never see notes; first reply stops the clock", async () => {
    actAs(owner);
    expect((await adminList.GET(req("/x"))).status).toBe(403);
    actAs(admin);
    const list = await json(await adminList.GET(req("/x?status=active")));
    expect((list.body.tickets as { id: string }[]).some((x) => x.id === ticketId)).toBe(true);
    await adminTicket.POST(post({ body: "Their wallet is empty, that's why.", internal: true }), params({ id: ticketId }));
    let t = (await json(await adminTicket.GET(req("/x"), params({ id: ticketId })))).body.ticket as { firstResponseAt: string | null; messages: unknown[] };
    expect(t.firstResponseAt).toBeNull();
    expect(t.messages).toHaveLength(2);
    const reply = await json(await adminTicket.POST(post({ body: "Your wallet balance ran out. Please top up and the campaign continues.", status: "waiting" }), params({ id: ticketId })));
    t = reply.body.ticket as typeof t;
    expect(t.firstResponseAt).not.toBeNull();
    expect(reply.body.ticket).toMatchObject({ status: "waiting", assignee: { id: admin.id } });
    expect(await db.notification.count({ where: { userId: agent.id, title: { contains: "MECGURA replied" } } })).toBe(1);

    actAs(owner);
    const seen = (await json(await clientTicket.GET(req("/x"), params({ orgId, id: ticketId })))).body.ticket as { messages: { internal: boolean; body: string }[] };
    expect(seen.messages).toHaveLength(2);
    expect(seen.messages.some((m) => m.body.includes("wallet is empty"))).toBe(false);
    // Internal note attachments can't be fetched by the client.
    actAs(admin);
    const withFile = await json(await adminTicket.POST(post({ body: "screenshot", internal: true, attachments: [{ filename: "note.pdf", data: PDF }] }), params({ id: ticketId })));
    const noteFile = (withFile.body.ticket as { messages: { internal: boolean; attachments: { id: string }[] }[] }).messages.filter((m) => m.internal).at(-1)!.attachments[0].id;
    expect((await adminFile.GET(req("/x"), params({ aid: noteFile }))).status).toBe(200);
    actAs(owner);
    expect((await clientFile.GET(req("/x"), params({ orgId, aid: noteFile }))).status).toBe(404);

    // Client replies → open again; then marks it sorted.
    const back = await json(await clientTicket.POST(post({ body: "Topped up, thanks!" }), params({ orgId, id: ticketId })));
    expect(back.body.ticket).toMatchObject({ status: "open" });
    expect((await json(await clientResolve.POST(post({}), params({ orgId, id: ticketId })))).body.ticket).toMatchObject({ status: "resolved" });
  });

  it("missed deadlines are escalated once; priority changes move the deadline", async () => {
    actAs(owner);
    const t = (await json(await clientList.POST(post({ subject: "Number disconnected", category: "whatsapp", priority: "urgent", body: "Customers can't reach us since morning." }), P()))).body.ticket as { id: string; number: number };
    await db.supportTicket.update({ where: { id: t.id }, data: { slaDueAt: new Date(Date.now() - 60_000) } });
    actAs(admin);
    const breached = await json(await adminList.GET(req("/x?breached=true")));
    expect((breached.body.tickets as { id: string; breached: boolean }[])[0]).toMatchObject({ id: t.id, breached: true });
    expect(await escalateBreaches()).toBeGreaterThanOrEqual(1);
    await escalateBreaches();
    expect(await db.notification.count({ where: { userId: admin.id, title: { contains: `SLA missed: #${t.number}` } } })).toBe(1);
    const moved = await json(await adminTicket.PATCH(req("/x", { method: "PATCH", body: { priority: "low" } }), params({ id: t.id })));
    expect(new Date((moved.body.ticket as { slaDueAt: string }).slaDueAt).getTime()).toBeGreaterThan(Date.now());
    expect((await adminTicket.PATCH(req("/x", { method: "PATCH", body: { assigneeId: owner.id } }), params({ id: t.id }))).status).toBe(400);
    const rep = await json(await adminList.GET(req("/x?status=all")));
    expect(rep.body.report).toMatchObject({ created: expect.any(Number) });
  });

  it("other workspaces can't see or reply to these tickets", async () => {
    actAs(stranger);
    expect((await clientTicket.GET(req("/x"), params({ orgId, id: ticketId }))).status).toBe(403);
    expect((await clientTicket.GET(req("/x"), params({ orgId: otherOrg, id: ticketId }))).status).toBe(404);
    expect((await clientTicket.POST(post({ body: "hi" }), params({ orgId: otherOrg, id: ticketId }))).status).toBe(404);
    expect((await clientFile.GET(req("/x"), params({ orgId: otherOrg, aid: fileId }))).status).toBe(404);
    expect((await json(await clientList.GET(req("/x"), params({ orgId: otherOrg })))).body.tickets).toEqual([]);
  });
});

describe("system health", () => {
  it("only admins see it; lists provider set-up and failures; down checks alert once an hour", async () => {
    actAs(owner);
    expect((await healthRoute.GET(req("/x"))).status).toBe(403);
    actAs(admin);
    const h = await json(await healthRoute.GET(req("/x")));
    expect(h.status).toBe(200);
    const checks = h.body.checks as { key: string; status: string }[];
    expect(checks.find((c) => c.key === "database")?.status).toBe("ok");
    expect(checks.find((c) => c.key === "voice")?.status).toBe("config");
    expect(Array.isArray(h.body.failures)).toBe(true);

    // Scheduler hasn't ticked in hours → "down" → one alert, not repeated within the hour.
    await db.siteSetting.upsert({ where: { key: "scheduler:lastTick" }, create: { key: "scheduler:lastTick", value: "0" }, update: { value: "0" } });
    await db.$executeRawUnsafe(`UPDATE "SiteSetting" SET "updatedAt" = '2020-01-01 00:00:00' WHERE "key" = 'scheduler:lastTick'`);
    await db.siteSetting.deleteMany({ where: { key: { startsWith: "health:" } } });
    expect(await runHealthAlerts()).toBeGreaterThanOrEqual(1);
    await db.siteSetting.deleteMany({ where: { key: "health:lastRun" } });
    expect(await runHealthAlerts()).toBe(0);
    expect(await db.notification.count({ where: { userId: admin.id, title: { contains: "Down: Scheduler" } } })).toBe(1);
  });
});
