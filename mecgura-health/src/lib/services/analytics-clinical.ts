import "server-only";
import type { TenantRequestContext } from "@/lib/auth/context";
import { compareValues, rate, type Comparison } from "@/lib/analytics/range";
import { dailySeries, durationStats, minutesBetween, tally, titleCase } from "@/lib/analytics/stats";
import { IN_CHUNK, ROW_CAP, chunk, doctorNames, doctorWhere, drill, insufficientHistory, runDomain } from "./analytics-core";

/**
 * Consultation / diagnosis / prescription and laboratory analytics.
 * DESCRIPTIVE ONLY: counts and times of structured, recorded data. No free text, no AI, no prediction, no treatment advice.
 */
const cmp = (cur: number, prev: number | null, hist: boolean): Comparison | null => (prev === null ? null : compareValues(cur, prev, { insufficientHistory: hist }));
const hours = (min: number | null) => (min === null ? null : Math.round(min / 60));

export function clinicalAnalytics(ctx: TenantRequestContext, raw: unknown, silent = false) {
  return runDomain(ctx, raw, "clinical", ["analytics.clinical"], async (env) => {
    const r = env.range; const d = doctorWhere(env);
    const cons: { doctorUserId: string; status: string; startedAt: Date; finalizedAt: Date | null; followUpRequired: boolean }[] =
      await env.tdb.consultation.findMany({ where: { startedAt: { gte: r.start, lt: r.end }, ...d }, select: { doctorUserId: true, status: true, startedAt: true, finalizedAt: true, followUpRequired: true }, take: ROW_CAP });
    const fin = cons.filter((c) => c.status === "FINALIZED");
    const dur = durationStats(fin.map((c) => minutesBetween(c.startedAt, c.finalizedAt)));
    const diag: { name: string; code: string | null; type: string }[] = await env.tdb.consultationDiagnosis.findMany({ where: { consultation: { is: { startedAt: { gte: r.start, lt: r.end }, status: "FINALIZED", ...d } } }, select: { name: true, code: true, type: true }, take: ROW_CAP });
    const rx: { status: string; items: { name: string; genericName: string | null }[] }[] = await env.tdb.prescription.findMany({ where: { createdAt: { gte: r.start, lt: r.end }, ...d }, select: { status: true, items: { select: { name: true, genericName: true } } }, take: ROW_CAP });
    const rxFinal = rx.filter((p) => p.status === "FINALIZED");
    const med = new Map<string, number>(); for (const p of rxFinal) for (const i of p.items) { const k = (i.genericName?.trim() || i.name.trim()).toLowerCase(); if (k) med.set(k, (med.get(k) ?? 0) + 1); }
    const perDay = new Map<string, number>(); for (const c of fin) { const k = env.localize(c.finalizedAt ?? c.startedAt).date; perDay.set(k, (perDay.get(k) ?? 0) + 1); }
    let prevFinal: number | null = null;
    if (r.previous) prevFinal = await env.tdb.consultation.count({ where: { startedAt: { gte: r.previous.start, lt: r.previous.end }, status: "FINALIZED", ...d } });
    const hist = await insufficientHistory(env);
    const names = env.doctorId ? new Map<string, string>() : await doctorNames(env, cons.map((c) => c.doctorUserId));
    const byDoc = new Map<string, number>(); for (const c of fin) byDoc.set(c.doctorUserId, (byDoc.get(c.doctorUserId) ?? 0) + 1);
    return {
      note: "Descriptive counts of recorded, structured data only. Nothing here is a diagnosis, recommendation or prediction.",
      consultations: { total: cons.length, finalized: fin.length, inProgress: cons.filter((c) => c.status === "IN_PROGRESS" || c.status === "DRAFT" || c.status === "READY_FOR_REVIEW").length, cancelled: cons.filter((c) => c.status === "CANCELLED").length, comparison: cmp(fin.length, prevFinal, hist), statuses: tally(cons, (c) => c.status, { labels: Object.fromEntries(cons.map((c) => [c.status, titleCase(c.status)])) }), trend: dailySeries(r.from, r.to, perDay) },
      duration: { ...dur, definition: "Minutes from the consultation record being opened to it being finalised (finalised consultations only).", note: dur.available ? null : "Data unavailable — no finalised consultation in this period." },
      followUpRequired: { count: fin.filter((c) => c.followUpRequired).length, ratePct: rate(fin.filter((c) => c.followUpRequired).length, fin.length), definition: "Finalised consultations where a follow-up was requested ÷ finalised consultations." },
      byDoctor: env.doctorId ? [] : [...byDoc.entries()].map(([id, count]) => ({ doctorId: id, name: names.get(id) ?? "Doctor", count })).sort((a, b) => a.name.localeCompare(b.name)),
      diagnoses: { recorded: diag.length, distinct: new Set(diag.map((x) => (x.code ?? x.name).toLowerCase())).size, top: tally(diag, (x) => (x.code ? `${x.code} · ${x.name}` : x.name), { top: 15 }), types: tally(diag, (x) => x.type, { labels: Object.fromEntries(diag.map((x) => [x.type, titleCase(x.type)])) }) },
      prescriptions: { total: rx.length, finalized: rxFinal.length, avgItems: rxFinal.length ? Math.round((rxFinal.reduce((a, p) => a + p.items.length, 0) * 10) / rxFinal.length) / 10 : null, statuses: tally(rx, (p) => p.status, { labels: Object.fromEntries(rx.map((p) => [p.status, titleCase(p.status)])) }), topMedicines: [...med.entries()].map(([key, count]) => ({ key, label: key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 15) },
      drill: { consultations: drill(env, "consultations"), diagnoses: drill(env, "diagnoses") },
    };
  }, { audit: !silent });
}

const LAB_DONE = ["REPORT_GENERATED", "DOCTOR_REVIEWED", "CANCELLED"];
export function labAnalytics(ctx: TenantRequestContext, raw: unknown, silent = false) {
  return runDomain(ctx, raw, "lab", ["analytics.lab"], async (env) => {
    const r = env.range; const d = doctorWhere(env); const od = env.doctorId ? { order: { is: { doctorUserId: env.doctorId } } } : {};
    const orders: { status: string; priority: string }[] = await env.tdb.investigationOrder.findMany({ where: { orderedAt: { gte: r.start, lt: r.end }, ...d }, select: { status: true, priority: true }, take: ROW_CAP });
    const samples: { status: string; rejectionReason: string | null; sampleType: string }[] = await env.tdb.sample.findMany({ where: { collectedAt: { gte: r.start, lt: r.end }, ...od }, select: { status: true, rejectionReason: true, sampleType: true }, take: ROW_CAP });
    const released: { releasedAt: Date; investigationOrderId: string; order: { orderedAt: Date } }[] = await env.tdb.labReport.findMany({ where: { releasedAt: { gte: r.start, lt: r.end }, ...d }, select: { releasedAt: true, investigationOrderId: true, order: { select: { orderedAt: true } } }, take: ROW_CAP });
    const recv = new Map<string, Date>();
    for (const c of chunk(released.map((x) => x.investigationOrderId), IN_CHUNK)) for (const s of await env.tdb.sample.findMany({ where: { investigationOrderId: { in: c }, receivedAt: { not: null }, status: { not: "REJECTED" } }, select: { investigationOrderId: true, receivedAt: true } })) { const cur = recv.get(s.investigationOrderId); if (!cur || s.receivedAt < cur) recv.set(s.investigationOrderId, s.receivedAt); }
    const tat = durationStats(released.map((x) => minutesBetween(x.order.orderedAt, x.releasedAt)));
    const proc = durationStats(released.map((x) => minutesBetween(recv.get(x.investigationOrderId), x.releasedAt)));
    const items: { testNameSnapshot: string }[] = await env.tdb.investigationOrderItem.findMany({ where: { order: { is: { orderedAt: { gte: r.start, lt: r.end }, ...d } }, status: { not: "CANCELLED" } }, select: { testNameSnapshot: true }, take: ROW_CAP });
    const pending: { status: string }[] = await env.tdb.investigationOrder.findMany({ where: { status: { notIn: LAB_DONE }, ...d }, select: { status: true }, take: ROW_CAP });
    const rejected = samples.filter((s) => s.status === "REJECTED"); const rr = rejected.filter((s) => s.rejectionReason?.trim());
    let prev: { ordered: number; released: number } | null = null;
    if (r.previous) prev = { ordered: await env.tdb.investigationOrder.count({ where: { orderedAt: { gte: r.previous.start, lt: r.previous.end }, ...d } }), released: await env.tdb.labReport.count({ where: { releasedAt: { gte: r.previous.start, lt: r.previous.end }, ...d } }) };
    const hist = await insufficientHistory(env);
    return {
      totals: { ordered: orders.length, cancelled: orders.filter((o) => o.status === "CANCELLED").length, samplesCollected: samples.length, samplesRejected: rejected.length, reportsReleased: released.length, pending: pending.length },
      comparison: prev && { ordered: cmp(orders.length, prev.ordered, hist), released: cmp(released.length, prev.released, hist) },
      rejection: { ratePct: rate(rejected.length, samples.length), definition: "Rejected samples ÷ samples collected in the period.", reasons: { recorded: rr.length, notRecorded: rejected.length - rr.length, items: tally(rr, (s) => s.rejectionReason!.trim().toLowerCase().slice(0, 60), { top: 8 }) } },
      turnaround: { orderedToReleased: { ...tat, averageHours: hours(tat.averageMin), medianHours: hours(tat.medianMin), longestHours: hours(tat.maxMin) }, receivedToReleased: { ...proc, averageHours: hours(proc.averageMin), medianHours: hours(proc.medianMin), longestHours: hours(proc.maxMin) }, definition: "Time from the order (or sample receipt) to the report being released, for reports released in the period. Negative or missing times are excluded.", note: tat.available ? null : "Data unavailable — no report was released in this period." },
      pendingByStatus: tally(pending, (o) => o.status, { labels: Object.fromEntries(pending.map((o) => [o.status, titleCase(o.status)])), order: ["ORDERED", "CONFIRMED", "SAMPLE_PENDING", "SAMPLE_COLLECTED", "SAMPLE_RECEIVED", "PROCESSING", "RESULT_READY"] }),
      statuses: tally(orders, (o) => o.status, { labels: Object.fromEntries(orders.map((o) => [o.status, titleCase(o.status)])) }),
      priorities: tally(orders, (o) => o.priority, { labels: Object.fromEntries(orders.map((o) => [o.priority, titleCase(o.priority)])) }),
      sampleTypes: tally(samples, (s) => s.sampleType, { top: 10 }),
      topTests: tally(items, (i) => i.testNameSnapshot, { top: 10 }),
      drill: { orders: drill(env, "lab"), released: drill(env, "lab", { status: "RELEASED" }) },
    };
  }, { audit: !silent });
}
