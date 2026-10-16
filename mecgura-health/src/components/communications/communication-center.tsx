"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Card, CardHeader, DataTable, ErrorState, Modal, Pagination, Select, StatusBadge, TextInput, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";
import { CHANNEL, STATUS, failText, when } from "./comms-labels";

interface Row { id: string; createdAt: string; channel: string; event: string; eventLabel: string; status: string; provider: string | null; patient: { id: string; name: string; code: string } | null; recipient: string; failureCode: string | null; failureReason: string | null; attempts: number; priority: string }
interface Page { rows: Row[]; total: number; page: number; pageSize: number }
interface Stats { days: number; total: number; sent: number; delivered: number; failed: number; pending: number; retrying: number; skipped: number; channels: Record<string, number> }
interface Detail extends Row { language: string; template: string; providerMessageId: string | null; scheduledAt: string; sentAt: string | null; deliveredAt: string | null; readAt: string | null; failedAt: string | null; maxAttempts: number; preview: string | null; resendable: boolean; history: { at: string; status: string; source: string; code: string | null; note: string | null }[] }
interface Cfg { providers: { channel: string; configured: boolean; hint: string | null }[]; settings: { whatsappEnabled: boolean; smsEnabled: boolean; emailEnabled: boolean }; events: { key: string; label: string }[] }

const Stat = ({ label, value, tone }: { label: string; value: number | string; tone?: string }) => <div className="rounded-xl border border-line bg-surface p-4"><p className="type-caption">{label}</p><p className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p></div>;

/** Clinic communication centre: delivery numbers, a filterable log, and per-message detail. */
export function CommunicationCenter({ canTemplates, canConfigure }: { canTemplates: boolean; canConfigure: boolean }) {
  const toast = useToast(); const [f, setF] = useState({ channel: "", status: "", event: "", q: "", from: "", to: "" }); const [page, setPage] = useState(1); const [open, setOpen] = useState<string | null>(null);
  const qs = new URLSearchParams({ ...f, page: String(page) }).toString();
  const { data, error, loading, reload } = useApi<Page>(`/api/communications/messages?${qs}`);
  const stats = useApi<Stats>("/api/communications/stats?days=7"); const cfg = useApi<Cfg>("/api/communications/settings");
  const set = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setPage(1); };
  const anyOn = cfg.data && (cfg.data.settings.whatsappEnabled || cfg.data.settings.smsEnabled || cfg.data.settings.emailEnabled);
  const notReady = cfg.data?.providers.filter((p) => !p.configured) ?? [];
  return (
    <div className="space-y-section">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="type-page-title">Communications</h1><p className="type-secondary">WhatsApp, SMS and email sent to your patients. Last 7 days.</p></div>
        <div className="flex gap-2">{canTemplates && <Link href="/communications/templates" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 type-label">Templates</Link>}{canConfigure && <Link href="/settings/communications" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 type-label">Settings</Link>}</div></div>
      {cfg.data && !anyOn && <Alert tone="info" title="No channel is switched on">Nothing is sent to patients yet. {canConfigure ? <>Switch a channel on in <Link href="/settings/communications" className="underline">Settings</Link>.</> : "Ask a clinic admin to set it up."}</Alert>}
      {cfg.data && anyOn && notReady.length > 0 && <Alert tone="warning" title="Some providers are not configured">{notReady.map((p) => `${CHANNEL[p.channel]}: ${p.hint ?? "not configured"}`).join(" · ")}. Messages for those channels are not sent — they show as “Not sent” with the reason.</Alert>}
      <section aria-label="Delivery summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total" value={stats.data?.total ?? "—"} /><Stat label="Sent" value={stats.data?.sent ?? "—"} /><Stat label="Delivered" value={stats.data?.delivered ?? "—"} tone="text-success" /><Stat label="Failed" value={stats.data?.failed ?? "—"} tone={stats.data?.failed ? "text-danger" : ""} /><Stat label="Pending" value={stats.data?.pending ?? "—"} /><Stat label="Retrying" value={stats.data?.retrying ?? "—"} />
      </section>
      <p className="type-caption">By channel: WhatsApp {stats.data?.channels.WHATSAPP ?? "—"} · SMS {stats.data?.channels.SMS ?? "—"} · Email {stats.data?.channels.EMAIL ?? "—"}{stats.data?.skipped ? ` · ${stats.data.skipped} not sent (see log)` : ""}</p>
      <Card><CardHeader title="Message log" description="Newest first. Recipients are masked; message text is not shown here." />
        <div className="grid gap-3 border-b border-line p-card sm:grid-cols-2 lg:grid-cols-6">
          <TextInput aria-label="Search patient" placeholder="Patient name or ID" value={f.q} onChange={(e) => set({ q: e.target.value })} />
          <Select aria-label="Channel" value={f.channel} placeholder="All channels" onChange={(e) => set({ channel: e.target.value })} options={Object.entries(CHANNEL).map(([value, label]) => ({ value, label }))} />
          <Select aria-label="Status" value={f.status} placeholder="All statuses" onChange={(e) => set({ status: e.target.value })} options={Object.entries(STATUS).map(([value, [label]]) => ({ value, label }))} />
          <Select aria-label="Notification" value={f.event} placeholder="All notifications" onChange={(e) => set({ event: e.target.value })} options={(cfg.data?.events ?? []).map((e) => ({ value: e.key, label: e.label }))} />
          <TextInput aria-label="From date" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /><TextInput aria-label="To date" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
        {error ? <ErrorState code={error.code} description={error.message} action={<Button onClick={reload}>Try again</Button>} /> : (
          <DataTable caption="Communication log" loading={loading && !data} rows={data?.rows ?? []} rowKey={(r) => r.id} empty={{ title: "No messages match.", description: "Messages appear here when appointments, reports, bills and reminders trigger them." }} columns={[
            { key: "t", header: "When", cell: (r) => when(r.createdAt) },
            { key: "p", header: "Patient", cell: (r) => (r.patient ? <Link href={`/patients/${r.patient.id}`} className="type-label">{r.patient.name} <span className="type-caption">{r.patient.code}</span></Link> : "—") },
            { key: "e", header: "Notification", cell: (r) => r.eventLabel, hideOnMobile: true },
            { key: "c", header: "Channel", cell: (r) => CHANNEL[r.channel] ?? r.channel },
            { key: "s", header: "Status", cell: (r) => <StatusBadge tone={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0] ?? r.status}</StatusBadge> },
            { key: "a", header: "", align: "right", cell: (r) => <Button size="sm" variant="outline" onClick={() => setOpen(r.id)}>Details<span className="sr-only"> for {r.eventLabel}</span></Button> },
          ]} />
        )}
        <div className="px-card pb-card"><Pagination page={data?.page ?? 1} pageCount={Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)))} onPageChange={setPage} /></div>
      </Card>
      {open && <DetailModal id={open} onClose={() => setOpen(null)} onChanged={async () => { await reload(); await stats.reload(); }} toast={toast} />}
    </div>
  );
}

function DetailModal({ id, onClose, onChanged, toast }: { id: string; onClose: () => void; onChanged: () => Promise<void>; toast: ReturnType<typeof useToast> }) {
  const { data, error } = useApi<Detail>(`/api/communications/messages/${id}`); const [busy, setBusy] = useState(false);
  async function resend() { setBusy(true); const r = await apiFetch<{ queued: number; skipped: string | null }>(`/api/communications/messages/${id}/resend`, { method: "POST" }); setBusy(false); if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return; } toast(r.data.queued ? { tone: "success", title: "Queued to resend" } : { tone: "warning", title: "Not resent", description: r.data.skipped ?? undefined }); await onChanged(); }
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-4 py-1.5"><dt className="type-caption shrink-0">{k}</dt><dd className="type-secondary break-words text-right">{v}</dd></div>;
  return (
    <Modal open onClose={onClose} title="Message details" description={data ? `${data.eventLabel} · ${CHANNEL[data.channel]}` : undefined} footer={<>{data?.resendable && <Button onClick={resend} loading={busy}>Resend</Button>}<Button variant="outline" onClick={onClose}>Close</Button></>}>
      {error ? <Alert tone="danger">{error.message}</Alert> : !data ? <p className="type-secondary">Loading…</p> : (
        <div className="space-y-4">
          <dl className="divide-y divide-line">
            {row("Status", <StatusBadge tone={STATUS[data.status]?.[1]}>{STATUS[data.status]?.[0] ?? data.status}</StatusBadge>)}
            {row("Patient", data.patient ? `${data.patient.name} (${data.patient.code})` : "—")}{row("Recipient", data.recipient)}{row("Template", data.template)}{row("Language", data.language)}
            {row("Provider", data.provider ?? "—")}{row("Provider message ID", data.providerMessageId ? <code className="break-all text-xs">{data.providerMessageId}</code> : "—")}
            {row("Queued for", when(data.scheduledAt))}{row("Sent", when(data.sentAt))}{row("Delivered", when(data.deliveredAt))}{row("Read", when(data.readAt))}{row("Attempts", `${data.attempts} of ${data.maxAttempts}`)}
          </dl>
          {data.failureCode && <Alert tone={data.status === "FAILED" ? "danger" : "info"} title={data.status === "SKIPPED" ? "Why it was not sent" : "What went wrong"}>{failText(data.failureCode, data.failureReason)} <span className="type-caption">({data.failureCode})</span></Alert>}
          {data.preview && <div><p className="type-label">Text preview</p><p className="type-secondary mt-1 rounded-lg bg-surface-muted p-3">{data.preview}{data.preview.length >= 160 ? "…" : ""}</p></div>}
          <div><p className="type-label">History</p><ol className="mt-2 space-y-1">{data.history.map((h, i) => <li key={i} className="type-caption">{when(h.at)} — {STATUS[h.status]?.[0] ?? h.status} <span className="opacity-70">({h.source.toLowerCase()}{h.code ? `, ${h.code}` : ""})</span></li>)}</ol></div>
        </div>
      )}
    </Modal>
  );
}
