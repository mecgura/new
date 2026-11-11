import { writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ctxFor, makeUser, seedSystemData, asTenant } from "@/test/helpers";
import { listPatients } from "@/lib/services/patient-crm";
import { listAppointments } from "@/lib/services/appointments";
import { queueSnapshot } from "@/lib/services/opd";
import { listInvoices } from "@/lib/services/billing-invoices";
import { auditCenter } from "@/lib/services/platform-admin";
import { platformDashboard } from "@/lib/services/platform-monitor";
import { listNotifications, staffActor } from "@/lib/services/notifications";
import { securityOverview, listSecurityEvents } from "@/lib/services/sec-center";
import { platformAnalytics } from "@/lib/services/analytics-command";

const N = { patients: 20_000, appointments: 60_000, opd: 20_000, invoices: 20_000, audit: 200_000, notifications: 30_000, events: 50_000 };
const chunks = <T,>(a: T[], n = 2000) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const rows: { name: string; ms: number; note: string }[] = [];
async function time(name: string, fn: () => Promise<unknown>, budgetMs: number) {
  const first = (await fn()) as { rows?: unknown[]; items?: unknown[]; total?: number } | null; if (first && typeof first === "object" && ("rows" in first || "items" in first) && !(first.rows ?? first.items)?.length) throw new Error(`${name} returned no rows — the benchmark would be meaningless`); const t: number[] = []; for (let i = 0; i < 5; i++) { const s = performance.now(); await fn(); t.push(performance.now() - s); } t.sort((a, b) => a - b); const ms = Math.round(t[2]);
  rows.push({ name, ms, note: ms <= budgetMs ? "ok" : `OVER BUDGET (${budgetMs} ms)` }); return ms;
}
let admin: ReturnType<typeof ctxFor>; let sa: ReturnType<typeof ctxFor>; let doctors: string[] = [];
beforeAll(async () => {
  await seedSystemData();
  const t = await db.tenant.create({ data: { name: "Perf Clinic", slug: "perf-clinic", subdomain: "perf-clinic", status: "ACTIVE", timezone: "Asia/Kolkata", branding: { create: { primaryColor: "#0B5FA5", secondaryColor: "#0F766E", accentColor: "#0E9F6E" } } } });
  const a = (await makeUser("CLINIC_ADMIN", t.id)).user; admin = ctxFor(a, "CLINIC_ADMIN", t.id); sa = ctxFor((await makeUser("SUPER_ADMIN", null)).user, "SUPER_ADMIN", null);
  doctors = []; for (let i = 0; i < 4; i++) doctors.push((await makeUser("DOCTOR", t.id)).user.id);
  const now = Date.now(); const first = ["Aman", "Priya", "Rahul", "Simran", "Gurpreet", "Neha", "Karan", "Anjali"], last = ["Singh", "Sharma", "Kaur", "Verma", "Gill", "Mehta"];
  const pat = Array.from({ length: N.patients }, (_, i) => ({ tenantId: t.id, code: `P-${String(i + 1).padStart(6, "0")}`, name: `${first[i % 8]} ${last[i % 6]} ${i}`, phone: `9${String(100000000 + i).slice(0, 9)}`, status: i % 50 === 0 ? "ARCHIVED" : "ACTIVE", createdAt: new Date(now - (i % 700) * 86_400_000) }));
  for (const c of chunks(pat)) await db.patient.createMany({ data: c });
  const pids = (await db.patient.findMany({ where: { tenantId: t.id }, select: { id: true }, take: N.patients })).map((p) => p.id);
  const appts = Array.from({ length: N.appointments }, (_, i) => { const day = (i % 400) - 200; const start = new Date(now + day * 86_400_000 + (9 + (i % 8)) * 3_600_000); return { tenantId: t.id, publicId: `AP-${i}`, doctorUserId: doctors[i % 4], startsAt: start, endsAt: new Date(start.getTime() + 900_000), patientId: pids[i % pids.length], status: ["CONFIRMED", "COMPLETED", "CANCELLED", "REQUESTED"][i % 4], slotLock: `perf-${i}` }; });
  for (const c of chunks(appts)) await db.appointment.createMany({ data: c });
  const today = new Date().toISOString().slice(0, 10);
  const opd = Array.from({ length: N.opd }, (_, i) => ({ tenantId: t.id, patientId: pids[i % pids.length], doctorUserId: doctors[i % 4], tokenDate: i < 120 ? today : new Date(now - ((i % 300) + 1) * 86_400_000).toISOString().slice(0, 10), tokenNumber: i + 1, tokenLabel: `T${i + 1}`, publicToken: `pt-${i}`, queueSeq: i + 1, status: i < 120 ? ["WAITING", "IN_CONSULTATION", "COMPLETED"][i % 3] : "COMPLETED" }));
  for (const c of chunks(opd)) await db.opdVisit.createMany({ data: c });
  const inv = Array.from({ length: N.invoices }, (_, i) => ({ tenantId: t.id, invoiceNumber: `INV-${i}`, patientId: pids[i % pids.length], invoiceDate: new Date(now - (i % 365) * 86_400_000).toISOString().slice(0, 10), createdById: a.id, status: ["ISSUED", "PAID", "PARTIALLY_PAID", "CANCELLED"][i % 4] }));
  for (const c of chunks(inv)) await db.invoice.createMany({ data: c });
  const audit = Array.from({ length: N.audit }, (_, i) => ({ tenantId: i % 5 === 0 ? null : t.id, actorId: a.id, action: ["patient.viewed", "appointment.created", "auth.login.succeeded", "billing.payment_recorded"][i % 4], entityType: "x", entityId: String(i), createdAt: new Date(now - (i % 90) * 86_400_000 - i) }));
  for (const c of chunks(audit, 5000)) await db.auditLog.createMany({ data: c });
  const notes = Array.from({ length: N.notifications }, (_, i) => ({ tenantId: t.id, userId: a.id, type: "APPOINTMENT_REQUESTED", title: "n", dedupeKey: `d-${i}`, category: "APPOINTMENT", createdAt: new Date(now - i * 60_000), readAt: i % 3 === 0 ? new Date() : null }));
  for (const c of chunks(notes)) await db.notification.createMany({ data: c });
  const ev = Array.from({ length: N.events }, (_, i) => ({ severity: ["INFO", "LOW", "MEDIUM", "HIGH"][i % 4], category: "AUTH", type: i % 3 === 0 ? "LOGIN_FAILED" : "DATA_EXPORT", summary: "s", ip: `10.0.${i % 255}.${i % 200}`, createdAt: new Date(now - (i % 7) * 86_400_000 - i) }));
  for (const c of chunks(ev, 5000)) await db.securityEvent.createMany({ data: c });
});

describe("performance at scale (synthetic data)", () => {
  it("measures the screens that matter", async () => {
    const T = asTenant(admin); const day = new Date().toISOString().slice(0, 10); const in7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    await time("Patients list (page 1, 20k patients)", () => listPatients(T, { page: 1 }), 400);
    await time("Patient search by name prefix", () => listPatients(T, { q: "Gurpreet Kaur" }), 500);
    await time("Patient search by code", () => listPatients(T, { q: "P-001234" }), 500);
    await time("Appointments calendar (7 days)", () => listAppointments(T, { from: day, to: in7 }), 600);
    await time("Live OPD queue snapshot (today)", () => queueSnapshot(T, {}), 500);
    await time("Invoices list (page 1, 20k invoices)", () => listInvoices(T, {}), 500);
    await time("Notifications centre (30k rows)", () => listNotifications(staffActor(admin), {}), 500);
    await time("Platform: audit centre (200k rows, page 1)", () => auditCenter(sa, {}), 600);
    await time("Platform: audit centre filtered by category", () => auditCenter(sa, { category: "Patients" }), 800);
    await time("Platform dashboard", () => platformDashboard(sa), 800);
    await time("Platform analytics", () => platformAnalytics(sa), 1200);
    await time("Security Center overview (50k events)", () => securityOverview(sa), 800);
    await time("Security events list", () => listSecurityEvents(sa, { severity: "HIGH" }), 500);
    const md = `# Performance results (synthetic data, SQLite, single process)\n\nData: ${Object.entries(N).map(([k, v]) => `${v.toLocaleString("en-IN")} ${k}`).join(", ")}.\nMedian of 5 runs after one warm-up. Postgres in production will differ; use these as relative signals and regression guards.\n\n| Screen / query | median ms | verdict |\n|---|---:|---|\n${rows.map((r) => `| ${r.name} | ${r.ms} | ${r.note} |`).join("\n")}\n`;
    writeFileSync("perf/RESULTS.md", md); console.log("\n" + md);
    expect(rows.filter((r) => r.note !== "ok").map((r) => r.name)).toEqual([]);
  });
});
