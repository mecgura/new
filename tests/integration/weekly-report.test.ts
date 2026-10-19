import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { addMember, makeOrg, makeUser } from "../helpers";
import { buildWeeklyReport, sendWeeklyReports } from "@/services/reports/weekly";
import * as cron from "@/app/api/cron/weekly-report/route";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function workspace(opts: { activity?: boolean; email?: string } = {}) {
  const org = await makeOrg(`Weekly ${Math.random().toString(36).slice(2, 7)}`);
  const owner = await makeUser({ name: "Owner" });
  await addMember(org.id, owner.id, "CLIENT_OWNER");
  await db.organizationService.create({ data: { organizationId: org.id, service: "WHATSAPP_AUTOMATION", enabled: true } });
  if (opts.email) await db.organizationSettings.create({ data: { organizationId: org.id, notificationEmail: opts.email } });
  if (opts.activity) await db.contact.create({ data: { organizationId: org.id, phone: `+9199${String(Date.now()).slice(-8)}`, name: "New" } });
  return { org, owner };
}

describe("weekly report", () => {
  it("counts only this workspace's last 7 days", async () => {
    const a = await workspace({ activity: true });
    const b = await workspace();
    expect((await buildWeeklyReport(a.org.id)).newContacts).toBe(1);
    expect((await buildWeeklyReport(b.org.id)).newContacts).toBe(0);
    expect((await buildWeeklyReport(a.org.id, new Date(Date.now() + 8 * 86_400_000))).newContacts).toBe(0);
  });

  it("notifies owners of active workspaces once, skips quiet ones, emails only when a notification email is set", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_x");
    vi.stubEnv("EMAIL_FROM", "MECGURA <no-reply@mecgura.tech>");
    const sentTo: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      sentTo.push(...(JSON.parse(String(init?.body)).to as string[]));
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    });
    const busy = await workspace({ activity: true, email: "boss@shop.test" });
    const quiet = await workspace();
    const r1 = await sendWeeklyReports();
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    expect(await db.notification.count({ where: { userId: busy.owner.id, title: { contains: "your week on WhatsApp" } } })).toBe(1);
    expect(await db.notification.count({ where: { userId: quiet.owner.id } })).toBe(0);
    expect(sentTo).toContain("boss@shop.test");
    // A second run in the same week sends nothing more.
    await sendWeeklyReports();
    expect(await db.notification.count({ where: { userId: busy.owner.id, title: { contains: "your week on WhatsApp" } } })).toBe(1);
  });

  it("the cron endpoint needs the secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-s3cret");
    expect((await cron.GET(new Request("http://localhost:3000/api/cron/weekly-report"))).status).toBe(401);
    const ok = await cron.GET(new Request("http://localhost:3000/api/cron/weekly-report", { headers: { authorization: "Bearer s3cret-s3cret" } }));
    expect(ok.status).toBe(200);
  });
});
