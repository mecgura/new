import Link from "next/link";
import { Alert } from "@/components/ui";
import { titleCase } from "@/lib/analytics/stats";
import type { clinicInsights, operationsScorecard } from "@/lib/services/analytics-command";
import type { billingAnalytics, communicationAnalytics, pharmacyAnalytics } from "@/lib/services/analytics-business";
import type { clinicalAnalytics, labAnalytics } from "@/lib/services/analytics-clinical";
import type { appointmentAnalytics, doctorAnalytics, followUpAnalytics, opdAnalytics, patientAnalytics } from "@/lib/services/analytics-people";
import { BarList, DataTable, Definition, Freshness, HourlyChart, Kpi, KpiGrid, NoData, Section, TrendChart, Unavailable, fmtCount, fmtHours, fmtMinutes, fmtMoney, fmtPct } from "./widgets";

type R<F extends (...a: never[]) => Promise<unknown>> = Awaited<ReturnType<F>>;
const Stack = ({ children }: { children: React.ReactNode }) => <div className="space-y-section">{children}</div>;
const Two = ({ children }: { children: React.ReactNode }) => <div className="grid gap-section lg:grid-cols-2">{children}</div>;
const link = (href: string, text: string) => <Link href={href} className="type-label">{text}</Link>;

export function PatientsView({ r }: { r: R<typeof patientAnalytics> }) {
  const t = r.totals;
  return (
    <Stack>
      <Freshness meta={r.meta} />
      <KpiGrid label="Patient summary">
        <Kpi label="Patients" value={fmtCount(t.patients)} note={r.basis} snapshot /><Kpi label="New patients" value={fmtCount(t.newPatients)} comparison={t.newComparison} href={r.drill.newPatients} />
        <Kpi label="Patients seen" value={fmtCount(t.seenInRange)} note={`${t.seenNew} new · ${t.seenReturning} returning`} />
        <Kpi label="Retention" value={fmtPct(r.retention.ratePct)} note={r.retention.previousSeen ? `${r.retention.retained} of ${r.retention.previousSeen} patients came back` : "No patients seen in the previous period"} />
      </KpiGrid>
      <Section title="New patients per day"><TrendChart points={r.newTrend} label="New patients" /></Section>
      <Two>
        <Section title="Age groups" description={r.basis}><BarList items={r.ageGroups} empty="No patients" /></Section>
        <Section title="Gender"><BarList items={r.gender} empty="No patients" /></Section>
        <Section title="Locations (city)"><BarList items={r.locations} empty="No cities recorded" /></Section>
        <Section title="New vs returning" description="Distinct patients seen in the selected dates."><BarList items={[{ key: "new", label: "New patients (registered in this period)", count: t.seenNew }, { key: "returning", label: "Returning patients", count: t.seenReturning }]} empty="No patients were seen" /><Definition>{r.retention.definition}</Definition></Section>
      </Two>
    </Stack>
  );
}

export function AppointmentsView({ r }: { r: R<typeof appointmentAnalytics> }) {
  const t = r.totals; const c = r.comparison;
  return (
    <Stack>
      <Freshness meta={r.meta} />
      <KpiGrid label="Appointment summary">
        <Kpi label="Appointments" value={fmtCount(t.total)} comparison={c?.total} href={r.drill.all} /><Kpi label="Completed" value={fmtCount(t.completed)} comparison={c?.completed} />
        <Kpi label="Cancelled" value={fmtCount(t.cancelled)} comparison={c?.cancelled} goodWhen="down" href={r.drill.cancelled} /><Kpi label="No-shows" value={fmtCount(t.noShow)} comparison={c?.noShow} goodWhen="down" href={r.drill.noShow} />
        <Kpi label="No-show rate" value={fmtPct(r.rates.noShowPct)} note={r.rates.noShowDefinition} /><Kpi label="Cancellation rate" value={fmtPct(r.rates.cancellationPct)} note={r.rates.cancellationDefinition} />
        <Kpi label="Reschedule rate" value={fmtPct(r.rates.reschedulePct)} note={r.rates.rescheduleDefinition} /><Kpi label="Still upcoming" value={fmtCount(t.upcoming)} />
      </KpiGrid>
      <Section title="Appointments per day"><TrendChart points={r.trend} label="Appointments" /></Section>
      <Section title="Booking funnel" description="Requested → Confirmed → Checked in → Consultation → Completed. Each stage counts appointments that reached it."><BarList items={r.funnel.map((f) => ({ key: f.key, label: f.label, count: f.count, extra: f.pctOfPrevious === null ? undefined : `${fmtPct(f.pctOfPrevious)} of previous stage` }))} total={t.total} empty="No appointments" /></Section>
      <Two>
        <Section title="Status"><BarList items={r.statuses} hrefOf={(k) => `/analytics/reports/appointments?${new URLSearchParams({ preset: "custom", from: r.meta.range.from, to: r.meta.range.to, status: k })}`} empty="No appointments" /></Section>
        <Section title="Type"><BarList items={r.types} empty="No appointments" /></Section>
        <Section title="Booking source"><BarList items={r.sources} empty="No appointments" /></Section>
        <Section title="Cancellation reasons">
          {r.cancellationReasons.items.length ? <BarList items={r.cancellationReasons.items} /> : <Unavailable>{t.cancelled ? "No cancellation reasons were recorded." : "No cancellations in this period."}</Unavailable>}
          {t.cancelled > 0 && <Definition>{r.cancellationReasons.recorded} of {t.cancelled} cancellations have a reason recorded.</Definition>}
        </Section>
      </Two>
      <Two>
        <Section title="Busiest hours" description="By appointment start time (clinic time)."><HourlyChart hours={r.hourly} label="Appointments" /></Section>
        <Section title="Busiest weekdays"><BarList items={r.weekdays.map((d) => ({ key: String(d.day), label: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.day], count: d.count }))} empty="No appointments" /></Section>
      </Two>
    </Stack>
  );
}

export function OpdView({ r }: { r: R<typeof opdAnalytics> }) {
  const l = r.liveToday;
  return (
    <Stack>
      <Freshness meta={r.meta} />
      <KpiGrid label="Live OPD summary">
        <Kpi label="OPD visits" value={fmtCount(r.totals.visits)} comparison={r.comparison?.visits} href={r.drill.visits} /><Kpi label="Completed" value={fmtCount(r.totals.completed)} comparison={r.comparison?.completed} />
        <Kpi label="Average waiting time" value={fmtMinutes(r.waiting.averageMin)} muted={!r.waiting.available} note={r.waiting.available ? `${r.waiting.samples} visits` : null} />
        <Kpi label="Median waiting time" value={fmtMinutes(r.waiting.medianMin)} muted={!r.waiting.available} note={r.waiting.available ? `Longest ${fmtMinutes(r.waiting.maxMin)}` : null} />
        <Kpi label="Average consultation time" value={fmtMinutes(r.consultation.averageMin)} muted={!r.consultation.available} note={r.consultation.available ? `${r.consultation.samples} visits` : null} />
        <Kpi label="Median consultation time" value={fmtMinutes(r.consultation.medianMin)} muted={!r.consultation.available} /><Kpi label="Skipped" value={fmtCount(r.totals.skipped)} /><Kpi label="Distinct patients" value={fmtCount(r.totals.distinctPatients)} />
      </KpiGrid>
      {!r.waiting.available && <Unavailable>{r.waiting.note}</Unavailable>}
      <Definition>{r.waiting.definition} {r.consultation.definition}</Definition>
      <Section title="Right now" description="Today's queue."><KpiGrid label="Queue now"><Kpi label="Waiting" value={fmtCount(l.waiting)} snapshot /><Kpi label="Called" value={fmtCount(l.called)} snapshot /><Kpi label="In consultation" value={fmtCount(l.inConsultation)} snapshot /><Kpi label="Completed today" value={fmtCount(l.completed)} snapshot /></KpiGrid></Section>
      <Section title="Check-ins by hour" description="Hourly load by check-in time (clinic time)."><HourlyChart hours={r.hourly} label="Check-ins" /></Section>
      <Two><Section title="Visit status"><BarList items={r.statuses} empty="No visits" /></Section><Section title="Queue type"><BarList items={r.queues} empty="No visits" /></Section><Section title="Priority"><BarList items={r.priorities} empty="No visits" /></Section></Two>
    </Stack>
  );
}

export function DoctorsView({ r }: { r: R<typeof doctorAnalytics> }) {
  return (
    <Stack>
      <Freshness meta={r.meta} />
      <Alert tone="info">{r.note}</Alert>
      <Section title="Doctors" description="Alphabetical. Volumes depend on schedules and case mix.">
        <DataTable caption="Doctor activity" empty="No doctors" head={[{ label: "Doctor" }, { label: "Appointments", right: true }, { label: "Completed", right: true }, { label: "Cancelled", right: true }, { label: "No-shows", right: true }, { label: "Patients", right: true }, { label: "Final consultations", right: true }, { label: "Avg consultation", right: true }, { label: "Avg wait", right: true }, { label: "Lab orders", right: true }, ...(r.financialIncluded ? [{ label: "Billed", right: true }] : [])]}
          rows={r.doctors.map((d) => [d.name, d.appointments, d.completed, d.cancelled, d.noShow, d.distinctPatients, d.finalizedConsultations, d.avgConsultMin === null ? "—" : fmtMinutes(d.avgConsultMin), d.avgWaitMin === null ? "—" : fmtMinutes(d.avgWaitMin), d.labOrders, ...(r.financialIncluded ? [fmtMoney(d.billedMinor, r.currency ?? "INR")] : [])])} />
        <Definition>Utilisation: {r.utilisation}</Definition>
      </Section>
    </Stack>
  );
}

export function FollowUpsView({ r }: { r: R<typeof followUpAnalytics> }) {
  const t = r.totals;
  return (
    <Stack>
      <Freshness meta={r.meta} />
      <KpiGrid label="Follow-up summary">
        <Kpi label="Due in period" value={fmtCount(t.dueInPeriod)} comparison={r.comparison?.due} href={r.drill.all} /><Kpi label="Completed" value={fmtCount(t.completed)} comparison={r.comparison?.completed} />
        <Kpi label="Completion rate" value={fmtPct(r.completion.ratePct)} note={`${r.completion.numerator} of ${r.completion.denominator}`} /><Kpi label="Overdue now" value={fmtCount(r.backlog.overdue)} snapshot goodWhen="down" href={r.drill.overdue} />
        <Kpi label="Due today" value={fmtCount(r.backlog.dueToday)} snapshot /><Kpi label="Due in 7 days" value={fmtCount(r.backlog.next7Days)} snapshot /><Kpi label="No response" value={fmtCount(t.noResponse)} /><Kpi label="Rescheduled" value={fmtCount(t.rescheduled)} />
      </KpiGrid>
      <Definition>{r.completion.definition} {r.backlog.definition}</Definition>
      <Two><Section title="Status"><BarList items={r.statuses} empty="No follow-ups due" /></Section><Section title="Type"><BarList items={r.types} empty="No follow-ups due" /></Section><Section title="Priority"><BarList items={r.priorities} empty="No follow-ups due" /></Section><Section title="Source"><BarList items={r.sources} empty="No follow-ups due" /></Section></Two>
    </Stack>
  );
}

export function ClinicalView({ r }: { r: R<typeof clinicalAnalytics> }) {
  const c = r.consultations;
  return (
    <Stack>
      <Freshness meta={r.meta} />
      <Alert tone="info">{r.note}</Alert>
      <KpiGrid label="Consultation summary">
        <Kpi label="Consultations opened" value={fmtCount(c.total)} href={r.drill.consultations} /><Kpi label="Finalised" value={fmtCount(c.finalized)} comparison={c.comparison} /><Kpi label="In progress" value={fmtCount(c.inProgress)} />
        <Kpi label="Open to final" value={fmtMinutes(r.duration.averageMin)} muted={!r.duration.available} note={r.duration.available ? `median ${fmtMinutes(r.duration.medianMin)}` : null} /><Kpi label="Follow-up requested" value={fmtPct(r.followUpRequired.ratePct)} note={`${r.followUpRequired.count} of ${c.finalized} finalised`} />
        <Kpi label="Diagnoses recorded" value={fmtCount(r.diagnoses.recorded)} note={`${r.diagnoses.distinct} different`} /><Kpi label="Prescriptions finalised" value={fmtCount(r.prescriptions.finalized)} note={r.prescriptions.avgItems === null ? undefined : `${r.prescriptions.avgItems} medicines each on average`} />
      </KpiGrid>
      {!r.duration.available && <Unavailable>{r.duration.note}</Unavailable>}
      <Section title="Finalised consultations per day"><TrendChart points={c.trend} label="Finalised consultations" /></Section>
      <Two>
        <Section title="Most recorded diagnoses" description="Counts of structured diagnosis entries in finalised consultations."><BarList items={r.diagnoses.top} empty="No diagnoses recorded" />{link(r.drill.diagnoses, "Open the diagnosis report")}</Section>
        <Section title="Most prescribed medicines" description="From finalised prescriptions (by generic name when known)."><BarList items={r.prescriptions.topMedicines} empty="No prescriptions finalised" /></Section>
        <Section title="Consultation status"><BarList items={c.statuses} empty="No consultations" /></Section>
        {r.byDoctor.length > 0 && <Section title="Finalised by doctor" description="For context, not a ranking."><BarList items={r.byDoctor.map((d) => ({ key: d.doctorId, label: d.name, count: d.count }))} /></Section>}
      </Two>
    </Stack>
  );
}

export function LabView({ r }: { r: R<typeof labAnalytics> }) {
  const t = r.totals; const o = r.turnaround.orderedToReleased; const p = r.turnaround.receivedToReleased;
  return (
    <Stack>
      <Freshness meta={r.meta} />
      <KpiGrid label="Laboratory summary">
        <Kpi label="Orders" value={fmtCount(t.ordered)} comparison={r.comparison?.ordered} href={r.drill.orders} /><Kpi label="Samples collected" value={fmtCount(t.samplesCollected)} /><Kpi label="Samples rejected" value={fmtCount(t.samplesRejected)} note={`Rejection rate ${fmtPct(r.rejection.ratePct)}`} goodWhen="down" />
        <Kpi label="Reports released" value={fmtCount(t.reportsReleased)} comparison={r.comparison?.released} href={r.drill.released} /><Kpi label="Pending now" value={fmtCount(t.pending)} snapshot />
        <Kpi label="Average turnaround" value={fmtHours(o.averageHours)} muted={!o.available} note={o.available ? `${o.samples} reports` : null} /><Kpi label="Median turnaround" value={fmtHours(o.medianHours)} muted={!o.available} /><Kpi label="Longest turnaround" value={fmtHours(o.longestHours)} muted={!o.available} />
      </KpiGrid>
      {!o.available && <Unavailable>{r.turnaround.note}</Unavailable>}
      <Definition>{r.turnaround.definition} {r.rejection.definition}{p.available ? ` Sample receipt to release: average ${fmtHours(p.averageHours)}.` : ""}</Definition>
      <Two>
        <Section title="Pending reports by stage" description="Orders that have not reached a generated report (right now)."><BarList items={r.pendingByStatus} empty="Nothing pending" /></Section>
        <Section title="Order status"><BarList items={r.statuses} empty="No orders" /></Section>
        <Section title="Most ordered tests"><BarList items={r.topTests} empty="No tests ordered" /></Section>
        <Section title="Rejection reasons">{r.rejection.reasons.items.length ? <BarList items={r.rejection.reasons.items} /> : <Unavailable>{t.samplesRejected ? "No rejection reasons were recorded." : "No samples were rejected."}</Unavailable>}</Section>
        <Section title="Sample types"><BarList items={r.sampleTypes} empty="No samples" /></Section><Section title="Priority"><BarList items={r.priorities} empty="No orders" /></Section>
      </Two>
    </Stack>
  );
}

export function BillingView({ r }: { r: R<typeof billingAnalytics> }) {
  const t = r.totals; const cur = r.currency; const m = (x: number | null) => fmtMoney(x, cur); const d = r.discounts as { available: boolean; note?: string; invoices?: number; totalMinor?: number; averageMinor?: number; pctOfGross?: number | null; reasons?: { key: string; label: string; count: number }[]; byUser?: { userId: string; name: string; count: number; amountMinor: number }[] };
  return (
    <Stack>
      <Freshness meta={r.meta} />
      <Alert tone="info">{r.definitions.note}</Alert>
      <KpiGrid label="Billing summary">
        <Kpi label="Gross billed" value={m(t.grossBilledMinor)} note="Before discount and tax" /><Kpi label="Discounts" value={m(t.discountsMinor)} /><Kpi label="Taxes" value={m(t.taxesMinor)} />
        <Kpi label="Net billed" value={m(t.netBilledMinor)} comparison={r.comparison?.netBilled} href={r.drill.invoices} /><Kpi label="Collected" value={m(t.collectedMinor)} comparison={r.comparison?.collected} href={r.drill.payments} /><Kpi label="Refunded" value={m(t.refundedMinor)} href={r.drill.refunds} />
        <Kpi label="Net collected" value={m(t.netCollectedMinor)} note="Collected minus refunds" /><Kpi label="Outstanding (these invoices)" value={m(t.outstandingMinor)} />
        <Kpi label="Invoices" value={fmtCount(t.invoices)} note={`${t.paid} paid · ${t.partiallyPaid} partially paid`} /><Kpi label="Average invoice" value={m(t.averageInvoiceMinor)} /><Kpi label="Cancelled invoices" value={fmtCount(t.cancelledInvoices)} note={m(t.cancelledValueMinor)} />
      </KpiGrid>
      <details className="type-caption rounded-md border border-line bg-surface p-3"><summary className="type-label cursor-pointer">How these figures are defined</summary><ul className="mt-2 list-disc space-y-1 pl-5">{Object.entries(r.definitions).filter(([k]) => k !== "note").map(([k, v]) => <li key={k}><strong>{titleCase(k.replace(/([A-Z])/g, "_$1"))}:</strong> {v}</li>)}</ul></details>
      <Section title="Billed and collected per day"><TrendChart points={r.billedTrend} label="Net billed" format={(n) => m(n)} /><div className="mt-3"><TrendChart points={r.collectedTrend} label="Collected" format={(n) => m(n)} /></div></Section>
      <Two>
        <Section title="Payment methods" description="Successful payments only."><BarList items={r.paymentMethods.map((x) => ({ key: x.key, label: x.label, count: x.amountMinor }))} format={(n) => m(n)} empty="No payments in this period" /></Section>
        <Section title="Revenue by service type" description="From invoice snapshots.">
          <BarList items={r.serviceRevenue.map((x) => ({ key: x.key, label: x.label, count: x.amountMinor, extra: `${x.quantity} units` }))} format={(n) => m(n)} empty="No billed services" />
          {!r.serviceRevenueReconciles && <Definition>Service lines do not add up to invoice totals for this period (older or manually adjusted invoices).</Definition>}{link(r.drill.services, "Open the service report")}
        </Section>
        <Section title="Top services"><BarList items={r.topServices.map((x) => ({ key: x.key, label: x.label, count: x.amountMinor, extra: `${x.quantity} units` }))} format={(n) => m(n)} empty="No billed services" /></Section>
        <Section title="Outstanding balances now" description={r.outstandingNow.definition}>
          <p className="type-card-title tabular-nums">{m(r.outstandingNow.totalMinor)} <span className="type-caption">across {r.outstandingNow.invoices} invoices · {r.outstandingNow.overdueInvoices} overdue</span></p>
          <div className="mt-3"><BarList items={r.outstandingNow.aging.map((a) => ({ key: a.label, label: a.label, count: a.amountMinor, extra: `${a.count} invoices` }))} format={(n) => m(n)} empty="Nothing outstanding" /></div>
        </Section>
        <Section title="Refunds">
          <p className="type-secondary tabular-nums">Processed {m(r.refunds.processedMinor)} ({r.refunds.processedCount}) · Refund rate {fmtPct(r.refunds.ratePct)}</p><Definition>{r.refunds.rateDefinition}</Definition>
          <div className="mt-3"><BarList items={r.refunds.statuses} empty="No refund requests" /></div>
        </Section>
        <Section title="Discounts">
          {d.available ? (d.invoices ? <><p className="type-secondary tabular-nums">{d.invoices} invoices · {m(d.totalMinor ?? 0)} total · {m(d.averageMinor ?? 0)} average · {fmtPct(d.pctOfGross)} of gross</p><div className="mt-3"><BarList items={d.reasons ?? []} /></div>{d.byUser && d.byUser.length > 0 && <div className="mt-3"><BarList items={d.byUser.map((u) => ({ key: u.userId, label: u.name, count: u.amountMinor, extra: `${u.count} invoices` }))} format={(n) => m(n)} /></div>}</> : <NoData title="No discounts given" />) : <Unavailable>{d.note}</Unavailable>}
        </Section>
      </Two>
      {r.doctors.length > 0 && <Section title="Billed by doctor" description="For context, not a ranking."><DataTable caption="Billed by doctor" head={[{ label: "Doctor" }, { label: "Invoices", right: true }, { label: "Net billed", right: true }]} rows={(r.doctors as { doctorId: string | null; name: string; billedMinor: number; invoices: number }[]).map((x) => [x.name, x.invoices, m(x.billedMinor)])} /></Section>}
    </Stack>
  );
}

export function PharmacyView({ r }: { r: R<typeof pharmacyAnalytics> }) {
  const s = r.stock; const m = (x: number | null) => fmtMoney(x, r.currency); const mv = r.movements;
  return (
    <Stack>
      <Freshness meta={r.meta} />
      <KpiGrid label="Pharmacy summary">
        <Kpi label="Active medicines" value={fmtCount(s.activeMedicines)} snapshot /><Kpi label="Low stock" value={fmtCount(s.lowStock)} snapshot goodWhen="down" /><Kpi label="Out of stock" value={fmtCount(s.outOfStock)} snapshot goodWhen="down" />
        <Kpi label={`Expiring within ${s.nearExpiryDays} days`} value={fmtCount(s.nearExpiryBatches)} snapshot note="Batches with stock" href={r.drill.expiry} /><Kpi label="Expired, still in stock" value={fmtCount(s.expiredBatchesWithStock)} snapshot goodWhen="down" href={r.drill.expiry} />
        <Kpi label="Stock value" value={s.valuation.configured ? m(s.valuation.valueMinor) : "Stock valuation not configured"} muted={!s.valuation.configured} snapshot note={s.valuation.method} />
        <Kpi label="Dispensed" value={fmtCount(r.dispensing.count)} note={m(r.dispensing.valueMinor)} href={r.drill.dispensing} /><Kpi label="Purchases received" value={fmtCount(r.purchases.count)} note={m(r.purchases.valueMinor)} />
      </KpiGrid>
      <Definition>{s.definition} {r.purchases.definition}</Definition>
      <Two>
        <Section title="Top dispensed medicines" description="Units dispensed in the period, net of returns."><BarList items={r.topDispensed} empty="Nothing dispensed in this period" /></Section>
        <Section title="Stock adjustments" description="Units moved in the period."><DataTable caption="Stock movements" head={[{ label: "Movement" }, { label: "Entries", right: true }, { label: "Units", right: true }]} rows={[["Adjustments in", mv.adjustmentsIn.entries, mv.adjustmentsIn.units], ["Adjustments out", mv.adjustmentsOut.entries, mv.adjustmentsOut.units], ["Damaged", mv.damaged.entries, mv.damaged.units], ["Expired and written off", mv.expiredWrittenOff.entries, mv.expiredWrittenOff.units], ["Returned to supplier", mv.returnsToSupplier.entries, mv.returnsToSupplier.units]]} /></Section>
      </Two>
      <Section title="Medicines needing attention" description="Low or out of stock right now.">
        <DataTable caption="Low and out of stock medicines" empty="Every active medicine is above its reorder level" head={[{ label: "Medicine" }, { label: "Sellable stock", right: true }, { label: "Reorder level", right: true }, { label: "Status" }]} rows={r.lowStockList.map((x) => [x.name, x.available, x.reorderLevel, titleCase(x.status)])} />
        {link(r.drill.stock, "Open the full stock report")}
      </Section>
    </Stack>
  );
}

export function CommunicationView({ r }: { r: R<typeof communicationAnalytics> }) {
  const t = r.totals;
  return (
    <Stack>
      <Freshness meta={r.meta} />
      <Alert tone="info">{r.privacy}</Alert>
      <KpiGrid label="Communication summary">
        <Kpi label="Messages" value={fmtCount(t.messages)} comparison={t.comparison} href={r.drill.messages} /><Kpi label="Sent" value={fmtCount(t.sent)} /><Kpi label="Delivered" value={fmtCount(t.delivered)} /><Kpi label="Failed" value={fmtCount(t.failed)} note={`Failure rate ${fmtPct(t.failureRatePct)}`} goodWhen="down" /><Kpi label="Still queued" value={fmtCount(t.pending)} />
      </KpiGrid>
      <Section title="By channel" description="“Not available” means the channel does not report that state.">
        <DataTable caption="Messages by channel" empty="No messages" head={[{ label: "Channel" }, { label: "Total", right: true }, { label: "Sent", right: true }, { label: "Delivered", right: true }, { label: "Read", right: true }, { label: "Failed", right: true }, { label: "Delivery rate", right: true }]}
          rows={r.channels.map((c) => [c.label, c.total, c.sent, c.delivered === null ? "Not available" : c.delivered, c.read === null ? "Not available" : c.read, c.failed === null ? "Not available" : c.failed, c.deliveryRatePct === null ? "Not available" : fmtPct(c.deliveryRatePct)])} />
      </Section>
      <Two><Section title="Message types"><BarList items={r.eventTypes} empty="No messages" /></Section><Section title="Failure codes"><BarList items={r.failureCodes} empty="No failures" /></Section></Two>
    </Stack>
  );
}

export function InsightsView({ r }: { r: R<typeof clinicInsights> }) {
  return (
    <Stack>
      <Freshness meta={r.meta} />
      <Alert tone="info">{r.method} Thresholds are set by your clinic admin.</Alert>
      {!r.insights.length ? <Section title="Clinic insights"><NoData title="Nothing needs attention" description={`Checked against your thresholds: ${r.evaluated.map(titleCase).join(", ") || "no sections"}.`} /></Section> : (
        <ul className="space-y-3">{r.insights.map((i) => (
          <li key={i.key} className="rounded-lg border border-line bg-surface p-4">
            <p className="type-card-title"><span className={i.severity === "critical" ? "text-danger" : "text-warning"}>{i.severity === "critical" ? "Needs attention now — " : "Worth a look — "}</span>{i.title}</p>
            <p className="type-secondary mt-1">{i.detail}</p><p className="mt-2">{link(i.href, "See the data")}</p>
          </li>))}</ul>
      )}
    </Stack>
  );
}

export function ScorecardView({ r }: { r: R<typeof operationsScorecard> }) {
  const groups = [...new Set(r.items.map((i) => i.group))];
  const show = (i: (typeof r.items)[number]) => i.unavailable ?? (i.value === null ? "N/A" : i.unit === "percent" ? `${i.value}%` : i.unit === "minutes" ? fmtMinutes(i.value) : i.unit === "hours" ? fmtHours(i.value) : fmtCount(i.value));
  return (
    <Stack>
      <Freshness meta={r.meta} />
      <Alert tone="info">{r.note}</Alert>
      {groups.map((g) => (
        <Section key={g} title={g}>
          <DataTable caption={`${g} measures`} head={[{ label: "Measure" }, { label: "Value", right: true }, { label: "Based on" }, { label: "Definition" }]} rows={r.items.filter((i) => i.group === g).map((i) => [i.label, show(i), i.sample ?? "", i.definition])} />
        </Section>
      ))}
    </Stack>
  );
}
