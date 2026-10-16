import type { Metadata } from "next";
import { Alert, Card, CardHeader, StatusBadge } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/context";
import { platformCommOverview } from "@/lib/services/comms-platform";
import { providerMonitor } from "@/lib/services/platform-monitor";

export const metadata: Metadata = { title: "Communication monitoring" };
export const dynamic = "force-dynamic";
const CH: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email" };
const Stat = ({ label, value, danger }: { label: string; value: number; danger?: boolean }) => <div className="rounded-xl border border-line bg-surface p-4"><p className="type-caption">{label}</p><p className={`mt-1 text-2xl font-semibold tabular-nums ${danger && value ? "text-danger" : ""}`}>{value}</p></div>;

/** Super Admin: delivery health across all clinics. Aggregates only; provider keys are never shown. */
export default async function Page() {
  const ctx = await requirePagePermission("platform.manage"); const [o, pm] = await Promise.all([platformCommOverview(ctx, 7), providerMonitor(ctx)]);
  return (
    <div className="space-y-section">
      <div><h1 className="type-page-title">Communication monitoring</h1><p className="type-secondary">All clinics, last {o.days} days. Message text and recipients are not shown here.</p></div>
      {!o.scheduler.configured && <Alert tone="warning" title="Scheduler is off">CRON_SECRET is not set, so nothing calls <code>/api/internal/communications/run</code>. Reminders and retries need it.{o.scheduler.inlineWorker ? " New messages are still delivered right after they are queued." : ""}</Alert>}
      <section aria-label="Providers"><Card><CardHeader title="Providers" description="Set in the server environment. Secrets are never displayed." />
        <ul className="divide-y divide-line">{o.providers.map((p) => <li key={p.channel} className="flex flex-wrap items-center justify-between gap-2 p-card"><div><p className="type-label">{CH[p.channel]}{p.provider ? ` — ${p.provider}` : ""}</p><p className="type-caption">{p.configured ? (p.webhookReady ? "Ready. Delivery receipts are on." : "Ready to send, but the webhook secret is missing so delivery receipts are off.") : (p.hint ?? "Not configured")}</p></div><StatusBadge tone={p.configured ? "success" : "warning"}>{p.configured ? "Configured" : "Not configured"}</StatusBadge></li>)}</ul></Card></section>
      <section aria-label="Provider health"><Card><CardHeader title="Provider health" description="Last success and failure, and failures in the last 7 days." /><ul className="divide-y divide-line">{pm.map((p) => <li key={p.channel} className="flex flex-wrap items-center justify-between gap-2 p-card"><span className="type-label">{CH[p.channel]} <span className="type-caption">{p.provider ?? "no provider"}</span></span><span className="type-secondary">{p.health} · {p.failures7d} failed (7 d){p.lastFailureCode ? ` · last: ${p.lastFailureCode}` : ""} · webhook {p.webhookReady ? "ready" : "not set up"}</span></li>)}</ul></Card></section>
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"><Stat label="Total" value={o.totals.total} /><Stat label="Sent" value={o.totals.sent} /><Stat label="Delivered" value={o.totals.delivered} /><Stat label="Failed" value={o.totals.failed} danger /><Stat label="Pending" value={o.totals.pending} /><Stat label="Due now" value={o.totals.dueNow} danger /></section>
      <div className="grid gap-section lg:grid-cols-2">
        <Card><CardHeader title="By channel" /><ul className="divide-y divide-line">{o.channels.map((c) => <li key={c.channel} className="flex justify-between p-card"><span className="type-label">{CH[c.channel]}</span><span className="type-secondary">{c.count} messages · {c.failed} failed</span></li>)}</ul></Card>
        <Card><CardHeader title="Top failure reasons" />{o.failureCodes.length ? <ul className="divide-y divide-line">{o.failureCodes.map((f) => <li key={f.code} className="flex justify-between p-card"><code className="text-sm">{f.code}</code><span className="type-secondary">{f.count}</span></li>)}</ul> : <p className="type-secondary p-card">No failures in this period.</p>}</Card>
      </div>
      <Card><CardHeader title="Clinics" description="Busiest first." />{o.clinics.length ? <div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Messages per clinic</caption><thead><tr className="type-caption border-b border-line"><th scope="col" className="p-card">Clinic</th><th scope="col" className="p-card text-right">Messages</th><th scope="col" className="p-card text-right">Delivered</th><th scope="col" className="p-card text-right">Failed</th></tr></thead><tbody>{o.clinics.map((c) => <tr key={c.tenantId} className="border-b border-line last:border-0"><th scope="row" className="type-label p-card font-semibold">{c.clinic}</th><td className="p-card text-right tabular-nums">{c.total}</td><td className="p-card text-right tabular-nums">{c.delivered}</td><td className="p-card text-right tabular-nums">{c.failed}</td></tr>)}</tbody></table></div> : <p className="type-secondary p-card">No messages yet.</p>}</Card>
    </div>
  );
}
