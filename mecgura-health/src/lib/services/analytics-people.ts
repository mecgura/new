import "server-only";
import type { TenantRequestContext } from "@/lib/auth/context";
import { OPEN_STATUSES } from "@/lib/followups/core";
import { compareValues, rate, resolveRange, type Comparison } from "@/lib/analytics/range";
import { AGE_GROUPS, ageGroup, ageOf, dailySeries, durationStats, minutesBetween, tally, titleCase } from "@/lib/analytics/stats";
import { addDays } from "@/lib/scheduling/time";
import { APPOINTMENT_STATUSES } from "@/lib/scheduling/states";
import { IN_CHUNK, ROW_CAP, chunk, currencyOf, doctorWhere, drill, insufficientHistory, runDomain, db as _db, type Env } from "./analytics-core";

/** Patient, appointment, live-OPD, doctor and follow-up analytics. Every number is a count or time difference of real rows of THIS clinic. */
const cmp = (cur: number, prev: number | null, hist: boolean): Comparison | null => (prev === null ? null : compareValues(cur, prev, { insufficientHistory: hist }));
void _db;

/* ------------------------------------------------------------------ patients ------------------------------------------------------------------ */
async function visitedPatients(env: Env, from: string, to: string, start: Date, end: Date): Promise<Set<string>> {
  const d = doctorWhere(env);
  const [opd, cons, appts] = await Promise.all([
    env.tdb.opdVisit.findMany({ where: { tokenDate: { gte: from, lte: to }, status: { not: "CANCELLED" }, ...d }, select: { patientId: true }, take: ROW_CAP }),
    env.tdb.consultation.findMany({ where: { startedAt: { gte: start, lt: end }, status: { not: "CANCELLED" }, ...d }, select: { patientId: true }, take: ROW_CAP }),
    env.tdb.appointment.findMany({ where: { startsAt: { gte: start, lt: end }, status: "COMPLETED", patientId: { not: null }, ...d }, select: { patientId: true }, take: ROW_CAP }),
  ]);
  return new Set<string>([...opd, ...cons, ...appts].map((r: { patientId: string }) => r.patientId));
}
async function seenAllTime(env: Env): Promise<string[]> {
  const d = { doctorUserId: env.doctorId! };
  const [opd, cons, appts] = await Promise.all([
    env.tdb.opdVisit.findMany({ where: d, select: { patientId: true }, take: ROW_CAP }), env.tdb.consultation.findMany({ where: d, select: { patientId: true }, take: ROW_CAP }),
    env.tdb.appointment.findMany({ where: { ...d, patientId: { not: null } }, select: { patientId: true }, take: ROW_CAP }),
  ]);
  return [...new Set<string>([...opd, ...cons, ...appts].map((r: { patientId: string }) => r.patientId))];
}

export function patientAnalytics(ctx: TenantRequestContext, raw: unknown, silent = false) {
  return runDomain(ctx, raw, "patients", ["analytics.patients"], async (env) => {
    type P = { id: string; gender: string | null; dateOfBirth: Date | null; ageYears: number | null; city: string | null; createdAt: Date; status: string };
    const sel = { id: true, gender: true, dateOfBirth: true, ageYears: true, city: true, createdAt: true, status: true };
    let pop: P[];
    if (env.doctorId) { const ids = await seenAllTime(env); pop = (await Promise.all(chunk(ids, IN_CHUNK).map((c) => env.tdb.patient.findMany({ where: { id: { in: c } }, select: sel })))).flat(); }
    else pop = await env.tdb.patient.findMany({ select: sel, take: ROW_CAP });
    const r = env.range; const inWin = (p: P, s: Date, e: Date) => p.createdAt >= s && p.createdAt < e;
    const newPatients = pop.filter((p) => inWin(p, r.start, r.end));
    const cur = await visitedPatients(env, r.from, r.to, r.start, r.end);
    const byId = new Map(pop.map((p) => [p.id, p]));
    const visitedNew = [...cur].filter((id) => { const p = byId.get(id); return p && p.createdAt >= r.start; }).length;
    const visitedReturning = [...cur].filter((id) => { const p = byId.get(id); return p && p.createdAt < r.start; }).length;
    // basic retention: of the patients seen in the equal-length period just before, how many were seen again in this one
    const prevRange = r.previous ?? resolveRange({ preset: "custom", from: addDays(r.from, -r.days), to: addDays(r.from, -1) }, env.tz, env.today);
    const prev = await visitedPatients(env, prevRange.from, prevRange.to, prevRange.start, prevRange.end);
    const retained = [...prev].filter((id) => cur.has(id)).length;
    const hist = await insufficientHistory(env);
    const prevNew = r.previous ? pop.filter((p) => inWin(p, r.previous!.start, r.previous!.end)).length : null;
    const counts = new Map<string, number>(); for (const p of newPatients) { const d = env.localize(p.createdAt).date; counts.set(d, (counts.get(d) ?? 0) + 1); }
    return {
      basis: env.doctorId ? "Patients you have seen (all time)" : "All registered patients of this clinic",
      totals: { patients: pop.length, archived: pop.filter((p) => p.status === "ARCHIVED").length, newPatients: newPatients.length, newComparison: cmp(newPatients.length, prevNew, hist), seenInRange: cur.size, seenNew: visitedNew, seenReturning: visitedReturning },
      retention: { previousSeen: prev.size, retained, ratePct: rate(retained, prev.size), definition: "Share of patients seen in the previous equal-length period who were seen again in this period (distinct patients)." },
      gender: tally(pop, (p) => p.gender ? titleCase(p.gender) : null, { missing: "Not recorded" }),
      ageGroups: [...AGE_GROUPS.map((g) => ({ key: g as string, label: g as string, count: pop.filter((p) => ageGroup(ageOf(p, r.to)) === g).length })), { key: "Not recorded", label: "Not recorded", count: pop.filter((p) => ageGroup(ageOf(p, r.to)) === null).length }],
      locations: tally(pop, (p) => p.city, { missing: "Not recorded", top: 10 }),
      newTrend: dailySeries(r.from, r.to, counts),
      drill: { newPatients: drill(env, "patients"), seen: drill(env, "patients") },
    };
  }, { audit: !silent });
}

/* ---------------------------------------------------------------- appointments ---------------------------------------------------------------- */
const PAST_CONFIRM = ["CONFIRMED", "CHECKED_IN", "WAITING", "CALLED", "IN_CONSULTATION", "COMPLETED", "ON_HOLD", "SKIPPED"];
const PAST_CHECKIN = ["CHECKED_IN", "WAITING", "CALLED", "IN_CONSULTATION", "COMPLETED", "ON_HOLD", "SKIPPED"];
const PAST_CONSULT = ["IN_CONSULTATION", "COMPLETED"];
export function appointmentAnalytics(ctx: TenantRequestContext, raw: unknown) {
  return runDomain(ctx, raw, "appointments", ["analytics.operations"], async (env) => {
    const r = env.range; const now = new Date();
    const rows: { id: string; status: string; type: string; source: string; startsAt: Date; confirmedAt: Date | null; checkedInAt: Date | null; startedAt: Date | null; completedAt: Date | null; cancellationReason: string | null }[] =
      await env.tdb.appointment.findMany({ where: { startsAt: { gte: r.start, lt: r.end }, ...doctorWhere(env) }, select: { id: true, status: true, type: true, source: true, startsAt: true, confirmedAt: true, checkedInAt: true, startedAt: true, completedAt: true, cancellationReason: true }, take: ROW_CAP });
    const total = rows.length; const cancelled = rows.filter((a) => a.status === "CANCELLED"); const noShow = rows.filter((a) => a.status === "NO_SHOW"); const completed = rows.filter((a) => a.status === "COMPLETED");
    const due = rows.filter((a) => a.status !== "CANCELLED" && a.startsAt <= now);
    const reached = (a: (typeof rows)[number], statuses: string[], ts: (Date | null)[]) => statuses.includes(a.status) || ts.some(Boolean);
    const stages = [
      { key: "REQUESTED", label: "Requested", count: total },
      { key: "CONFIRMED", label: "Confirmed", count: rows.filter((a) => reached(a, PAST_CONFIRM, [a.confirmedAt, a.checkedInAt, a.startedAt, a.completedAt])).length },
      { key: "CHECKED_IN", label: "Checked in", count: rows.filter((a) => reached(a, PAST_CHECKIN, [a.checkedInAt, a.startedAt, a.completedAt])).length },
      { key: "IN_CONSULTATION", label: "Consultation", count: rows.filter((a) => reached(a, PAST_CONSULT, [a.startedAt, a.completedAt])).length },
      { key: "COMPLETED", label: "Completed", count: completed.length },
    ];
    // reschedule events come from the audit trail (stored, not guessed)
    const ids = rows.map((a) => a.id); const resched = new Set<string>();
    for (const c of chunk(ids, IN_CHUNK)) for (const a of await env.tdb.auditLog.findMany({ where: { action: "appointment.rescheduled", entityId: { in: c } }, select: { entityId: true }, take: ROW_CAP })) resched.add(a.entityId);
    const cReasons = cancelled.filter((a) => a.cancellationReason?.trim());
    const hist = await insufficientHistory(env);
    let prevTotals: { total: number; completed: number; cancelled: number; noShow: number } | null = null;
    if (r.previous) {
      const g = await env.tdb.appointment.groupBy({ by: ["status"], where: { startsAt: { gte: r.previous.start, lt: r.previous.end }, ...doctorWhere(env) }, _count: { _all: true } });
      const n = (s: string) => g.find((x: { status: string }) => x.status === s)?._count._all ?? 0;
      prevTotals = { total: g.reduce((a: number, x: { _count: { _all: number } }) => a + x._count._all, 0), completed: n("COMPLETED"), cancelled: n("CANCELLED"), noShow: n("NO_SHOW") };
    }
    const hours = new Array(24).fill(0) as number[]; const wd = new Array(7).fill(0) as number[]; const perDay = new Map<string, number>();
    for (const a of rows) { const l = env.localize(a.startsAt); hours[l.hour]++; wd[l.weekday]++; perDay.set(l.date, (perDay.get(l.date) ?? 0) + 1); }
    return {
      totals: { total, completed: completed.length, cancelled: cancelled.length, noShow: noShow.length, due: due.length, upcoming: rows.filter((a) => a.status !== "CANCELLED" && a.startsAt > now).length },
      comparison: prevTotals && { total: cmp(total, prevTotals.total, hist), completed: cmp(completed.length, prevTotals.completed, hist), cancelled: cmp(cancelled.length, prevTotals.cancelled, hist), noShow: cmp(noShow.length, prevTotals.noShow, hist) },
      rates: {
        noShowPct: rate(noShow.length, due.length), noShowDefinition: "No-shows ÷ appointments that were due (not cancelled and already past their start time).",
        cancellationPct: rate(cancelled.length, total), cancellationDefinition: "Cancelled ÷ all appointments in the period.",
        reschedulePct: rate(resched.size, total), rescheduleDefinition: "Appointments that were ever rescheduled ÷ all appointments in the period (from the audit trail).",
      },
      statuses: tally(rows, (a) => a.status, { order: APPOINTMENT_STATUSES, labels: Object.fromEntries(APPOINTMENT_STATUSES.map((s) => [s, titleCase(s)])) }),
      types: tally(rows, (a) => a.type, { labels: Object.fromEntries(rows.map((a) => [a.type, titleCase(a.type)])) }),
      sources: tally(rows, (a) => a.source, { labels: Object.fromEntries(rows.map((a) => [a.source, titleCase(a.source)])) }),
      funnel: stages.map((s, i) => ({ ...s, pctOfRequested: rate(s.count, total), pctOfPrevious: i === 0 ? null : rate(s.count, stages[i - 1].count) })),
      cancellationReasons: { recorded: cReasons.length, notRecorded: cancelled.length - cReasons.length, items: tally(cReasons, (a) => a.cancellationReason!.trim().toLowerCase().slice(0, 60), { top: 8 }) },
      rescheduled: resched.size,
      hourly: hours.map((count, hour) => ({ hour, count })), weekdays: wd.map((count, day) => ({ day, count })), trend: dailySeries(r.from, r.to, perDay),
      drill: { noShow: drill(env, "appointments", { status: "NO_SHOW" }), cancelled: drill(env, "appointments", { status: "CANCELLED" }), all: drill(env, "appointments") },
    };
  }, { audit: false });
}

/* -------------------------------------------------------------------- live OPD -------------------------------------------------------------------- */
export function opdAnalytics(ctx: TenantRequestContext, raw: unknown) {
  return runDomain(ctx, raw, "opd", ["analytics.operations"], async (env) => {
    const r = env.range;
    const rows: { status: string; queueType: string; priority: string; patientId: string; checkedInAt: Date; calledAt: Date | null; startedAt: Date | null; completedAt: Date | null }[] =
      await env.tdb.opdVisit.findMany({ where: { tokenDate: { gte: r.from, lte: r.to }, ...doctorWhere(env) }, select: { status: true, queueType: true, priority: true, patientId: true, checkedInAt: true, calledAt: true, startedAt: true, completedAt: true }, take: ROW_CAP });
    const live = rows.filter((v) => v.status !== "CANCELLED");
    const wait = durationStats(live.map((v) => minutesBetween(v.checkedInAt, v.calledAt)));
    const consult = durationStats(live.map((v) => minutesBetween(v.startedAt, v.completedAt)));
    const hours = new Array(24).fill(0) as number[]; for (const v of live) hours[env.localize(v.checkedInAt).hour]++;
    const todayRows = await env.tdb.opdVisit.groupBy({ by: ["status"], where: { tokenDate: env.today, ...doctorWhere(env) }, _count: { _all: true } });
    const t = (s: string) => todayRows.find((x: { status: string }) => x.status === s)?._count._all ?? 0;
    let prev: { visits: number; completed: number } | null = null;
    if (r.previous) { const g = await env.tdb.opdVisit.groupBy({ by: ["status"], where: { tokenDate: { gte: r.previous.from, lte: r.previous.to }, ...doctorWhere(env) }, _count: { _all: true } }); prev = { visits: g.filter((x: { status: string }) => x.status !== "CANCELLED").reduce((a: number, x: { _count: { _all: number } }) => a + x._count._all, 0), completed: g.find((x: { status: string }) => x.status === "COMPLETED")?._count._all ?? 0 }; }
    const hist = await insufficientHistory(env);
    const completed = live.filter((v) => v.status === "COMPLETED").length;
    return {
      totals: { visits: live.length, completed, skipped: live.filter((v) => v.status === "SKIPPED").length, onHold: live.filter((v) => v.status === "ON_HOLD").length, cancelled: rows.length - live.length, distinctPatients: new Set(live.map((v) => v.patientId)).size },
      comparison: prev && { visits: cmp(live.length, prev.visits, hist), completed: cmp(completed, prev.completed, hist) },
      waiting: { ...wait, definition: "Minutes from check-in to being called, for visits where both times were recorded.", note: wait.available ? null : "Data unavailable — no visit in this period has both a check-in and a call time." },
      consultation: { ...consult, definition: "Minutes from consultation start to completion, for visits where both times were recorded.", note: consult.available ? null : "Data unavailable — no visit in this period has both a start and a completion time." },
      liveToday: { waiting: t("WAITING"), called: t("CALLED"), inConsultation: t("IN_CONSULTATION"), completed: t("COMPLETED"), onHold: t("ON_HOLD") },
      hourly: hours.map((count, hour) => ({ hour, count })),
      statuses: tally(rows, (v) => v.status, { labels: Object.fromEntries(rows.map((v) => [v.status, titleCase(v.status)])) }),
      queues: tally(live, (v) => v.queueType, { labels: Object.fromEntries(live.map((v) => [v.queueType, titleCase(v.queueType)])) }),
      priorities: tally(live, (v) => v.priority, { labels: Object.fromEntries(live.map((v) => [v.priority, titleCase(v.priority)])) }),
      drill: { visits: drill(env, "opd") },
    };
  }, { audit: false });
}

/* ------------------------------------------------------------------- follow-ups ------------------------------------------------------------------- */
export function followUpAnalytics(ctx: TenantRequestContext, raw: unknown) {
  return runDomain(ctx, raw, "followups", ["analytics.operations"], async (env) => {
    const r = env.range; const d = doctorWhere(env);
    const rows: { status: string; type: string; priority: string; source: string; rescheduleCount: number }[] =
      await env.tdb.followUp.findMany({ where: { dueDate: { gte: r.from, lte: r.to }, ...d }, select: { status: true, type: true, priority: true, source: true, rescheduleCount: true }, take: ROW_CAP });
    const counted = rows.filter((f) => f.status !== "CANCELLED"); const completed = rows.filter((f) => f.status === "COMPLETED").length;
    const [overdue, dueToday, next7] = await Promise.all([
      env.tdb.followUp.count({ where: { status: { in: [...OPEN_STATUSES] }, dueDate: { lt: env.today }, ...d } }),
      env.tdb.followUp.count({ where: { status: { in: [...OPEN_STATUSES] }, dueDate: env.today, ...d } }),
      env.tdb.followUp.count({ where: { status: { in: [...OPEN_STATUSES] }, dueDate: { gt: env.today, lte: addDays(env.today, 7) }, ...d } }),
    ]);
    let prev: { due: number; completed: number } | null = null;
    if (r.previous) { const g = await env.tdb.followUp.groupBy({ by: ["status"], where: { dueDate: { gte: r.previous.from, lte: r.previous.to }, ...d }, _count: { _all: true } }); prev = { due: g.filter((x: { status: string }) => x.status !== "CANCELLED").reduce((a: number, x: { _count: { _all: number } }) => a + x._count._all, 0), completed: g.find((x: { status: string }) => x.status === "COMPLETED")?._count._all ?? 0 }; }
    const hist = await insufficientHistory(env);
    return {
      totals: { dueInPeriod: counted.length, created: rows.length, completed, patientDeclined: rows.filter((f) => f.status === "PATIENT_DECLINED").length, noResponse: rows.filter((f) => f.status === "NO_RESPONSE").length, expired: rows.filter((f) => f.status === "EXPIRED").length, cancelled: rows.length - counted.length, rescheduled: rows.filter((f) => f.rescheduleCount > 0).length },
      comparison: prev && { due: cmp(counted.length, prev.due, hist), completed: cmp(completed, prev.completed, hist) },
      completion: { ratePct: rate(completed, counted.length), numerator: completed, denominator: counted.length, definition: "Completed ÷ follow-ups due in the period, excluding cancelled ones." },
      backlog: { overdue, dueToday, next7Days: next7, definition: "Open follow-ups right now (not limited to the selected period)." },
      statuses: tally(rows, (f) => f.status, { labels: Object.fromEntries(rows.map((f) => [f.status, titleCase(f.status)])) }),
      types: tally(rows, (f) => f.type, { labels: Object.fromEntries(rows.map((f) => [f.type, titleCase(f.type)])) }),
      priorities: tally(rows, (f) => f.priority, { labels: Object.fromEntries(rows.map((f) => [f.priority, titleCase(f.priority)])) }),
      sources: tally(rows, (f) => f.source, { labels: Object.fromEntries(rows.map((f) => [f.source, titleCase(f.source)])) }),
      drill: { all: drill(env, "followups"), overdue: drill(env, "followups", { status: "OVERDUE" }) },
    };
  }, { audit: false });
}

/* ---------------------------------------------------------------------- doctors ---------------------------------------------------------------------- */
export function doctorAnalytics(ctx: TenantRequestContext, raw: unknown) {
  return runDomain(ctx, raw, "doctors", ["analytics.operations"], async (env) => {
    const r = env.range; const tdb = env.tdb; const seeFinance = env.ctx.permissions.has("analytics.financial");
    const docs: { id: string; name: string }[] = await tdb.user.findMany({ where: { role: { key: "DOCTOR" }, ...(env.doctorId ? { id: env.doctorId } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 });
    const [appts, cons, opd, labs, inv] = await Promise.all([
      tdb.appointment.groupBy({ by: ["doctorUserId", "status"], where: { startsAt: { gte: r.start, lt: r.end }, ...doctorWhere(env) }, _count: { _all: true } }),
      tdb.consultation.groupBy({ by: ["doctorUserId"], where: { finalizedAt: { gte: r.start, lt: r.end }, status: "FINALIZED", ...doctorWhere(env) }, _count: { _all: true } }),
      tdb.opdVisit.findMany({ where: { tokenDate: { gte: r.from, lte: r.to }, status: { not: "CANCELLED" }, ...doctorWhere(env) }, select: { doctorUserId: true, patientId: true, startedAt: true, completedAt: true, checkedInAt: true, calledAt: true }, take: ROW_CAP }),
      tdb.investigationOrder.groupBy({ by: ["doctorUserId"], where: { orderedAt: { gte: r.start, lt: r.end }, ...doctorWhere(env) }, _count: { _all: true } }),
      seeFinance ? tdb.invoice.groupBy({ by: ["doctorUserId"], where: { invoiceDate: { gte: r.from, lte: r.to }, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID", "REFUNDED", "PARTIALLY_REFUNDED"] }, ...doctorWhere(env) }, _sum: { totalMinor: true }, _count: { _all: true } }) : Promise.resolve([]),
    ]);
    const rows = docs.map((u) => {
      const a = appts.filter((x: { doctorUserId: string }) => x.doctorUserId === u.id); const n = (s: string) => a.find((x: { status: string }) => x.status === s)?._count._all ?? 0;
      const v = opd.filter((x: { doctorUserId: string }) => x.doctorUserId === u.id);
      const consult = durationStats(v.map((x: { startedAt: Date | null; completedAt: Date | null }) => minutesBetween(x.startedAt, x.completedAt)));
      const wait = durationStats(v.map((x: { checkedInAt: Date; calledAt: Date | null }) => minutesBetween(x.checkedInAt, x.calledAt)));
      const f = inv.find((x: { doctorUserId: string | null }) => x.doctorUserId === u.id);
      return {
        doctorId: u.id, name: u.name, appointments: a.reduce((s: number, x: { _count: { _all: number } }) => s + x._count._all, 0), completed: n("COMPLETED"), cancelled: n("CANCELLED"), noShow: n("NO_SHOW"),
        visits: v.length, distinctPatients: new Set(v.map((x: { patientId: string }) => x.patientId)).size, finalizedConsultations: cons.find((x: { doctorUserId: string }) => x.doctorUserId === u.id)?._count._all ?? 0,
        avgConsultMin: consult.averageMin, avgWaitMin: wait.averageMin, labOrders: labs.find((x: { doctorUserId: string }) => x.doctorUserId === u.id)?._count._all ?? 0,
        billedMinor: seeFinance ? (f?._sum.totalMinor ?? 0) : null,
      };
    });
    return { doctors: rows, financialIncluded: seeFinance, currency: seeFinance ? await currencyOf(env) : null, note: env.own ? "These are your own figures only." : "Shown for context. Volumes depend on schedules, case mix and booking patterns — this is not a ranking or a performance judgement.", utilisation: "Not calculated — schedule capacity is not part of this report.", drill: { all: drill(env, "appointments") } };
  }, { audit: false });
}
