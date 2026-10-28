import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { resetRateLimits } from "@/lib/rate-limit";
import { actAs, addMember, json, makeOrg, makeUser, params, req } from "../helpers";
import * as postsRoute from "@/app/api/organizations/[orgId]/social/posts/route";
import * as postRoute from "@/app/api/organizations/[orgId]/social/posts/[postId]/route";
import * as publishRoute from "@/app/api/organizations/[orgId]/social/posts/[postId]/publish/route";
import * as postedRoute from "@/app/api/organizations/[orgId]/social/posts/[postId]/posted/route";
import * as mediaRoute from "@/app/api/social-media/[key]/route";
import * as jobsRoute from "@/app/api/organizations/[orgId]/hiring/jobs/route";
import * as jobCandidates from "@/app/api/organizations/[orgId]/hiring/jobs/[jobId]/candidates/route";
import * as candidateRoute from "@/app/api/organizations/[orgId]/hiring/candidates/[candidateId]/route";
import * as applyRoute from "@/app/api/careers/[orgSlug]/[jobSlug]/apply/route";
import * as employeesRoute from "@/app/api/organizations/[orgId]/hr/employees/route";
import * as attendanceRoute from "@/app/api/organizations/[orgId]/hr/attendance/route";
import * as leaveRoute from "@/app/api/organizations/[orgId]/hr/leave/route";
import * as leaveOne from "@/app/api/organizations/[orgId]/hr/leave/[leaveId]/route";
import * as reportRoute from "@/app/api/organizations/[orgId]/hr/report/route";
import { runDueSocialPosts } from "@/services/social/posts";
import { publicJobs } from "@/services/hiring/ats";
import { todayIST } from "@/services/hr/hrms";

afterEach(() => vi.restoreAllMocks());

let n = 0;
const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
async function workspace(services: string[]) {
  const org = await makeOrg(`Module Biz ${n++}`);
  const owner = await makeUser({ name: "Owner" });
  const agent = await makeUser({ name: "Agent" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await addMember(org.id, agent.id, "AGENT");
  for (const s of services) await db.organizationService.create({ data: { organizationId: org.id, service: s, enabled: true } });
  const P = <E extends Record<string, string> = Record<never, string>>(extra?: E) => params({ orgId: org.id, ...(extra ?? ({} as E)) });
  return { org, owner, agent, P };
}
const body = (method: string, b: unknown) => req("/x", { method, body: b });

describe("social media", () => {
  it("is locked until the service is on, and only for owners and managers", async () => {
    const off = await workspace([]);
    actAs(off.owner);
    expect((await postsRoute.POST(body("POST", { caption: "Hi", channels: ["facebook"] }), off.P())).status).toBe(403);
    const on = await workspace(["SOCIAL_MEDIA"]);
    actAs(on.agent);
    expect((await postsRoute.POST(body("POST", { caption: "Hi", channels: ["facebook"] }), on.P())).status).toBe(403);
  });

  it("plans, schedules, publishes to the Facebook Page and records posts made by hand", async () => {
    const w = await workspace(["SOCIAL_MEDIA"]);
    actAs(w.owner);
    // Instagram needs an image; scheduling needs a future time.
    expect((await postsRoute.POST(body("POST", { caption: "Hello", channels: ["instagram"] }), w.P())).status).toBe(400);
    expect((await postsRoute.POST(body("POST", { caption: "Hello", channels: ["facebook"], status: "scheduled", scheduledAt: new Date(Date.now() - 3_600_000).toISOString() }), w.P())).status).toBe(400);

    const d = await json(await postsRoute.POST(body("POST", { caption: "Diwali sale!", channels: ["facebook", "instagram"], image: IMG }), w.P()));
    expect(d.status).toBe(201);
    const post = d.body.post as { id: string; imageUrl: string; status: string };
    expect(post.status).toBe("draft");
    const key = post.imageUrl.split("/").pop()!.split("?")[0];
    expect((await mediaRoute.GET(req("/x"), { params: Promise.resolve({ key }) })).headers.get("content-type")).toBe("image/png");

    // No connected accounts: publishing fails with a clear reason, and it can be marked as posted by hand.
    const failed = await json(await publishRoute.POST(body("POST", {}), w.P({ postId: post.id })));
    expect((failed.body.post as { status: string }).status).toBe("failed");
    const manual = await json(await postedRoute.POST(body("POST", {}), w.P({ postId: post.id })));
    expect((manual.body.post as { status: string }).status).toBe("published");
    expect((await postRoute.PUT(body("PUT", { caption: "x", channels: ["facebook"] }), w.P({ postId: post.id }))).status).toBe(409);

    // With the Page connected, a scheduled post goes out when its time comes.
    await db.channelAccount.create({ data: { organizationId: w.org.id, kind: "messenger", name: "Shop Page", address: `page${n}`, encryptedToken: encryptSecret("EAAtoken"), publicKey: `pk${Date.now()}${n}`, status: "active" } });
    const s = await json(await postsRoute.POST(body("POST", { caption: "Weekend offer", channels: ["facebook"], status: "scheduled", scheduledAt: new Date(Date.now() + 60_000).toISOString() }), w.P()));
    const sid = (s.body.post as { id: string }).id;
    await db.socialPost.update({ where: { id: sid }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "page_123" }), { status: 200 }));
    const r = await runDueSocialPosts();
    expect(r.published).toBeGreaterThanOrEqual(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/feed");
    const after = await db.socialPost.findUniqueOrThrow({ where: { id: sid } });
    expect(after.status).toBe("published");
    expect(JSON.parse(after.results).facebook.id).toBe("page_123");
  });
});

describe("hiring (ATS)", () => {
  it("jobs appear on the careers page, people apply, and the team moves them through the pipeline", async () => {
    resetRateLimits();
    const w = await workspace(["ATS"]);
    actAs(w.owner);
    const j = await json(await jobsRoute.POST(body("POST", { title: "Sales Executive", location: "Ludhiana", description: "Sell WhatsApp automation." }), w.P()));
    expect(j.status).toBe(201);
    const job = j.body.job as { id: string; slug: string };
    expect(job.slug).toBe("sales-executive");
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id } });
    expect((await publicJobs(org.slug))?.jobs.map((x) => x.title)).toEqual(["Sales Executive"]);

    const apply = (fields: Record<string, string>, file?: File) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      if (file) fd.set("resume", file);
      return applyRoute.POST(new Request("http://localhost:3000/x", { method: "POST", body: fd, headers: { host: "localhost:3000" } }), { params: Promise.resolve({ orgSlug: org.slug, jobSlug: job.slug }) });
    };
    actAs(null);
    expect((await apply({ name: "Aman", phone: "123" })).status).toBe(400);
    const a = await json(await apply({ name: "Aman Singh", phone: "98140 12345", experience: "2 years" }, new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "cv.pdf", { type: "application/pdf" })));
    expect(a.status).toBe(201);
    expect((await json(await apply({ name: "Aman Singh", phone: "9814012345" }))).body.duplicate).toBe(true);

    actAs(w.owner);
    const list = (await json(await jobCandidates.GET(req("/x"), w.P({ jobId: job.id })))).body.candidates as { id: string; stage: string; phone: string; contactId: string; resumeName: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ stage: "applied", phone: "+919814012345", resumeName: "cv.pdf" });
    expect(await db.contact.count({ where: { id: list[0].contactId, organizationId: w.org.id } })).toBe(1);
    const moved = await json(await candidateRoute.PATCH(body("PATCH", { stage: "interview", rating: 4, notes: "Good communication" }), w.P({ candidateId: list[0].id })));
    expect(moved.body.candidate).toMatchObject({ stage: "interview", rating: 4 });

    // Closed jobs stop taking applications; the careers page disappears when the service is turned off.
    await jobsRoute.POST(body("POST", { title: "Closed role", status: "closed" }), w.P());
    expect((await publicJobs(org.slug))?.jobs).toHaveLength(1);
    await db.organizationService.updateMany({ where: { organizationId: w.org.id, service: "ATS" }, data: { enabled: false } });
    expect(await publicJobs(org.slug)).toBeNull();
  });
});

describe("HRMS", () => {
  it("staff, daily attendance, leave that marks attendance, and the monthly report", async () => {
    const w = await workspace(["HRMS"]);
    const other = await workspace(["HRMS"]);
    actAs(w.owner);
    const e1 = (await json(await employeesRoute.POST(body("POST", { name: "Simran", designation: "Receptionist", salaryRupees: 15000 }), w.P()))).body.employee as { id: string };
    const e2 = (await json(await employeesRoute.POST(body("POST", { name: "Harpreet", designation: "Stylist" }), w.P()))).body.employee as { id: string };
    expect((await employeesRoute.POST(body("POST", { name: "X", phone: "12" }), w.P())).status).toBe(400);

    const today = todayIST();
    const reg = await json(await attendanceRoute.GET(req("/x"), w.P()));
    expect((reg.body.rows as unknown[]).length).toBe(2);
    const m = await json(await attendanceRoute.PUT(body("PUT", { date: today, entries: [{ employeeId: e1.id, status: "present", checkIn: "09:58" }, { employeeId: e2.id, status: "half_day" }] }), w.P()));
    expect(m.status).toBe(200);
    expect((m.body.rows as { id: string; status: string }[]).find((r) => r.id === e1.id)?.status).toBe("present");
    // Future dates and other workspaces' staff are refused.
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await attendanceRoute.PUT(body("PUT", { date: tomorrow, entries: [{ employeeId: e1.id, status: "present" }] }), w.P())).status).toBe(400);
    actAs(other.owner);
    expect((await attendanceRoute.PUT(body("PUT", { date: today, entries: [{ employeeId: e1.id, status: "absent" }] }), other.P())).status).toBe(404);

    actAs(w.owner);
    const month = today.slice(0, 7);
    const first = `${month}-01`;
    const l = await json(await leaveRoute.POST(body("POST", { employeeId: e2.id, from: first, to: first, type: "sick" }), w.P()));
    expect(l.status).toBe(201);
    await leaveOne.PATCH(body("PATCH", { status: "approved" }), w.P({ leaveId: (l.body.leave as { id: string }).id }));
    expect((await db.attendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: e2.id, date: first } } })).status).toBe("leave");

    const rep = await json(await reportRoute.GET(req(`/x?month=${month}`), w.P()));
    const rows = rep.body.rows as { name: string; present: number; leave: number; salaryRupees: number }[];
    expect(rows.find((r) => r.name === "Simran")).toMatchObject({ present: 1, salaryRupees: 15000 });
    expect(rows.find((r) => r.name === "Harpreet")?.leave).toBe(1);
    const csv = await reportRoute.GET(req(`/x?month=${month}&format=csv`), w.P());
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("Simran");

    actAs(w.agent);
    expect((await employeesRoute.GET(req("/x"), w.P())).status).toBe(403);
  });
});
