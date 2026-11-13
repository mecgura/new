"use client";

import * as React from "react";
import { IndianRupee, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, LoadingState, PageHeader, Select, Table, TBody, TD, TH, THead, TR, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Due = { id: string; name: string; phone: string; invoiceNo: string; amountPaise: number; dueDate: string | null; status: "pending" | "sent" | "paid" | "failed"; sentCount: number; lastSentAt: string | null; error: string };
type Data = { items: Due[]; unpaidPaise: number; paidPaise: number; count: number };
type Tpl = { id: string; name: string; language: string; category: string; body: string; waba: { numbers: { id: string; displayName: string; phoneNumber: string }[] } };

const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const TONE = { pending: "warning", sent: "info", paid: "success", failed: "danger" } as const;
const LABEL = { pending: "Not reminded", sent: "Reminded", paid: "Paid", failed: "Not sent" } as const;
const SAMPLE = "Name,Mobile,Bill No,Amount,Due Date\nRavi Traders,9876543210,INV-101,12500,15-12-2026";

/** Upload unpaid bills from Tally / Excel and remind customers on WhatsApp. */
export function DuesApp({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const base = `/api/organizations/${orgId}`;
  const toast = useToast();
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState("");
  const [templates, setTemplates] = React.useState<Tpl[]>([]);
  const [templateId, setTemplateId] = React.useState("");
  const [numberId, setNumberId] = React.useState("");
  const [csv, setCsv] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState<"" | "import" | "remind">("");
  const [note, setNote] = React.useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);

  const load = React.useCallback(async () => {
    const r = await apiFetch<Data>(`${base}/dues`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [base]);
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      void load();
      void apiFetch<{ templates: Tpl[] }>(`${base}/templates?status=approved`).then((r) => {
        if (r.ok) setTemplates(r.data.templates.filter((t) => t.category !== "AUTHENTICATION"));
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, [load, base]);

  const tpl = templates.find((t) => t.id === templateId);
  const numbers = tpl?.waba.numbers ?? [];

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 500_000) return setNote({ tone: "danger", text: "The file is too large. Keep it under 2,000 bills." });
    setCsv(await f.text());
    setFileName(f.name);
    setNote(null);
  }
  async function upload() {
    setBusy("import");
    setNote(null);
    const r = await apiFetch<{ added: number; updated: number; skippedCount: number; skipped: { line: number; reason: string }[] }>(`${base}/dues`, { method: "POST", body: { csv, consentConfirmed: consent } });
    setBusy("");
    if (!r.ok) return setNote({ tone: "danger", text: r.details ? Object.values(r.details).flat().join(" ") || r.error : r.error });
    const d = r.data;
    setNote({ tone: d.skippedCount ? "warning" : "success", text: `${d.added} new bill(s), ${d.updated} updated.${d.skippedCount ? ` ${d.skippedCount} row(s) skipped, for example line ${d.skipped[0].line}: ${d.skipped[0].reason}` : ""}` });
    setCsv("");
    setFileName("");
    void load();
  }
  async function remind() {
    if (!window.confirm("Send a WhatsApp reminder to every unpaid bill that has not been reminded in the last 24 hours?")) return;
    setBusy("remind");
    setNote(null);
    const r = await apiFetch<{ sent: number; failed: number }>(`${base}/dues/remind`, { method: "POST", body: { templateId, whatsappAccountId: numberId || numbers[0]?.id } });
    setBusy("");
    if (!r.ok) return setNote({ tone: "danger", text: r.details ? Object.values(r.details).flat().join(" ") || r.error : r.error });
    setNote({ tone: r.data.failed ? "warning" : "success", text: `${r.data.sent} reminder(s) sent${r.data.failed ? `, ${r.data.failed} could not be sent (see the list)` : ""}.` });
    void load();
  }
  async function paid(d: Due) {
    const r = await apiFetch(`${base}/dues/${d.id}`, { method: "PATCH", body: { paid: d.status !== "paid" } });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }
  async function remove(d: Due) {
    if (!window.confirm("Remove this bill from the list?")) return;
    const r = await apiFetch(`${base}/dues/${d.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!data) return <LoadingState />;
  return (
    <>
      <PageHeader title="Payment reminders" description="Upload unpaid bills from Tally or Excel. Customers get a polite WhatsApp reminder." />
      {note ? <Alert tone={note.tone} className="mb-4">{note.text}</Alert> : null}
      {canManage ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="1. Upload unpaid bills" description="A CSV file with columns such as Name, Mobile, Bill No, Amount, Due Date." />
            <CardBody className="space-y-3">
              <input type="file" accept=".csv,text/csv,text/plain" onChange={pick} className="block w-full text-small text-app-muted file:mr-3 file:rounded-md file:border file:border-app-border file:bg-app-surface file:px-3 file:py-2 file:text-app-text" aria-label="Unpaid bills file" />
              {fileName ? <p className="text-small text-app-muted">Ready: {fileName}</p> : null}
              <p className="text-caption text-app-subtle">
                Tally: Gateway → Display → Statements of Accounts → Outstandings → Receivables → Export → Excel, then save as CSV. Add a Mobile column if it is missing.{" "}
                <a className="underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`} download="unpaid-bills-sample.csv">Download a sample file</a>
              </p>
              <label className="flex items-start gap-2 text-small text-app-text">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
                <span>These are my customers and they agreed to get WhatsApp messages from my business.</span>
              </label>
              <Button onClick={upload} loading={busy === "import"} disabled={!csv || !consent}>Upload bills</Button>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="2. Send reminders" description="Uses an approved template. Variables fill in this order: name, amount, bill number, due date." />
            <CardBody className="space-y-3">
              {templates.length ? (
                <>
                  <Field id="due-template" label="Template">
                    <Select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setNumberId(""); }}>
                      <option value="">Choose a template…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name} ({t.language})</option>
                      ))}
                    </Select>
                  </Field>
                  {tpl ? <p className="rounded-md bg-app-hover p-2 text-small text-app-muted">{tpl.body}</p> : null}
                  {numbers.length > 1 ? (
                    <Field id="due-number" label="Send from">
                      <Select value={numberId || numbers[0].id} onChange={(e) => setNumberId(e.target.value)}>
                        {numbers.map((n) => (
                          <option key={n.id} value={n.id}>{n.displayName} ({n.phoneNumber})</option>
                        ))}
                      </Select>
                    </Field>
                  ) : null}
                  <Button onClick={remind} loading={busy === "remind"} disabled={!templateId || !numbers.length || !data.items.some((d) => d.status !== "paid")}>Send reminders now</Button>
                </>
              ) : (
                <Alert tone="info">
                  First create a Utility template in Templates and get it approved. Example: “Hello {"{{1}}"}, this is a reminder that {"{{2}}"} for bill {"{{3}}"} is due on {"{{4}}"}. Please ignore this message if you have already paid.”
                </Alert>
              )}
              <p className="text-caption text-app-subtle">A customer is not reminded twice within 24 hours. Mark a bill as Paid to stop its reminders.</p>
            </CardBody>
          </Card>
        </div>
      ) : null}
      <Card className="mt-4">
        <CardHeader title="Bills" description={`${rupees(data.unpaidPaise)} unpaid · ${rupees(data.paidPaise)} marked paid`} />
        {data.items.length ? (
          <Table caption="Unpaid bills" className="min-w-[640px]">
            <THead>
              <tr>
                <TH>Customer</TH>
                <TH>Bill</TH>
                <TH className="text-right">Amount</TH>
                <TH>Status</TH>
                <TH><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {data.items.map((d) => (
                <TR key={d.id}>
                  <TD>
                    {d.name || "Customer"}
                    <span className="block text-caption text-app-subtle">{d.phone}</span>
                  </TD>
                  <TD>
                    {d.invoiceNo || "-"}
                    {d.dueDate ? <span className="block text-caption text-app-subtle">Due {dayFmt.format(new Date(d.dueDate))}</span> : null}
                  </TD>
                  <TD className="text-right tabular-nums">{rupees(d.amountPaise)}</TD>
                  <TD>
                    <Badge tone={TONE[d.status]}>{LABEL[d.status]}{d.sentCount > 1 ? ` ×${d.sentCount}` : ""}</Badge>
                    {d.status === "failed" && d.error ? <span className="mt-1 block max-w-[16rem] text-caption text-red-300">{d.error}</span> : null}
                  </TD>
                  <TD className="text-right">
                    {canManage ? (
                      <span className="inline-flex items-center gap-1">
                        <Button size="sm" variant="secondary" onClick={() => paid(d)}>{d.status === "paid" ? "Mark unpaid" : "Mark paid"}</Button>
                        <button type="button" aria-label="Remove bill" onClick={() => remove(d)} className="rounded p-2 text-app-muted hover:bg-app-hover hover:text-red-300">
                          <Trash2 className="size-4" aria-hidden="true" />
                        </button>
                      </span>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon={IndianRupee} title="No bills yet" description="Upload your unpaid bills file to start sending reminders." className="py-8" />
        )}
      </Card>
    </>
  );
}
