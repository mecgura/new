"use client";

import * as React from "react";
import { ExternalLink, Landmark, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, Label, LoadingState, PageHeader, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { rupees } from "@/lib/pricing-client";

type Counts = { MARKETING: number; UTILITY: number; AUTHENTICATION: number };
type Account = {
  id: string;
  name: string;
  wabaId: string;
  organization: string;
  added: number;
  spent: number;
  remaining: number | null;
  low: boolean;
  thisMonth: { messages: Counts; cost: number };
  entries: { id: string; amountPaise: number; date: string; note: string }[];
};
type Overview = { rates: { marketing: number; utility: number; authentication: number }; lowAlertPaise: number; accounts: Account[] };

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function MetaBalanceApp() {
  const toast = useToast();
  const [data, setData] = React.useState<Overview | null>(null);
  const [error, setError] = React.useState("");
  const [rates, setRates] = React.useState({ marketing: "", utility: "", authentication: "" });
  const [low, setLow] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [forms, setForms] = React.useState<Record<string, { amount: string; date: string; note: string }>>({});

  const apply = React.useCallback((d: Overview) => {
    setData(d);
    setRates({ marketing: String(d.rates.marketing / 100), utility: String(d.rates.utility / 100), authentication: String(d.rates.authentication / 100) });
    setLow(String(d.lowAlertPaise / 100));
  }, []);
  const load = React.useCallback(
    () =>
      apiFetch<Overview>("/api/admin/meta-balance").then((r) => {
        if (!r.ok) return setError(r.error);
        setError("");
        apply(r.data);
      }),
    [apply]
  );
  React.useEffect(() => {
    void load();
  }, [load]);

  async function saveRates() {
    setBusy("rates");
    const r = await apiFetch("/api/admin/meta-rates", { method: "PUT", body: { marketing: Number(rates.marketing) * 100, utility: Number(rates.utility) * 100, authentication: Number(rates.authentication) * 100 } });
    const l = r.ok ? await apiFetch<Overview>("/api/admin/meta-balance", { method: "PUT", body: { lowAlert: Number(low) || 0 } }) : null;
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    if (l && !l.ok) return toast(l.error, "error");
    if (l?.ok) apply(l.data);
    toast("Saved. Cost estimates everywhere use the new rates.");
  }

  async function addFunds(a: Account) {
    const f = forms[a.id] ?? { amount: "", date: today(), note: "" };
    if (!(Number(f.amount) > 0)) return toast("Enter the amount you added in Meta.", "error");
    setBusy(a.id);
    const r = await apiFetch<Overview>("/api/admin/meta-balance", { method: "POST", body: { wabaRecordId: a.id, amount: Number(f.amount), date: f.date || today(), note: f.note } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    apply(r.data);
    setForms((x) => ({ ...x, [a.id]: { amount: "", date: today(), note: "" } }));
    toast("Top-up recorded.");
  }

  async function removeEntry(id: string) {
    const r = await apiFetch<Overview>("/api/admin/meta-balance", { method: "DELETE", body: { id } });
    if (!r.ok) return toast(r.error, "error");
    apply(r.data);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Meta balance"
        description="How much money is left with Meta for each WhatsApp Business account. Record every top-up you make in Meta, and MECGURA subtracts what was sent since. It's an estimate: Meta's billing page is the final word."
        actions={
          <a href="https://business.facebook.com/billing_hub/accounts" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 px-3 text-small font-semibold text-app-muted hover:text-app-text">
            <ExternalLink className="size-4" aria-hidden="true" /> Open Meta billing
          </a>
        }
      />
      {error ? <ErrorState description={error} onRetry={load} /> : null}
      {!data && !error ? <LoadingState /> : null}
      {data ? (
        <>
          {data.accounts.some((a) => a.low) ? (
            <Alert tone="warning" title="Low Meta balance">
              {data.accounts.filter((a) => a.low).map((a) => `${a.organization} (${a.name})`).join(", ")}: add funds in Meta soon so messages don&apos;t stop.
            </Alert>
          ) : null}

          {!data.accounts.length ? <EmptyState icon={Landmark} title="No live WhatsApp accounts" description="Accounts appear here once a real (not demo) number is connected." /> : null}

          <div className="grid gap-5 lg:grid-cols-2">
            {data.accounts.map((a) => {
              const f = forms[a.id] ?? { amount: "", date: today(), note: "" };
              const setF = (k: keyof typeof f, v: string) => setForms((x) => ({ ...x, [a.id]: { ...f, [k]: v } }));
              return (
                <Card key={a.id}>
                  <CardHeader title={a.organization} description={`${a.name} · WABA ${a.wabaId}`} action={a.low ? <Badge tone="danger">Low</Badge> : a.remaining !== null ? <Badge tone="success">OK</Badge> : null} />
                  <CardBody className="space-y-4">
                    <div>
                      <p className="text-small text-app-muted">Estimated balance left</p>
                      <p className={`font-display text-3xl font-bold ${a.low ? "text-red-300" : "text-app-text"}`}>{a.remaining === null ? "Not set up" : rupees(a.remaining)}</p>
                      {a.remaining !== null ? <p className="text-caption text-app-subtle">Added {rupees(a.added)} · spent about {rupees(a.spent)} since the first top-up</p> : <p className="text-caption text-app-subtle">Record the balance you have in Meta today to start tracking.</p>}
                    </div>
                    <div className="rounded-[var(--radius-control)] border border-app-border p-3 text-small">
                      <p className="font-semibold text-app-text">This month: about {rupees(a.thisMonth.cost)}</p>
                      <p className="text-app-muted">
                        {a.thisMonth.messages.MARKETING} marketing · {a.thisMonth.messages.UTILITY} utility · {a.thisMonth.messages.AUTHENTICATION} authentication
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <Label htmlFor={`amt-${a.id}`}>Added (₹)</Label>
                        <Input id={`amt-${a.id}`} type="number" min={1} inputMode="decimal" value={f.amount} onChange={(e) => setF("amount", e.target.value)} placeholder="2000" />
                      </div>
                      <div>
                        <Label htmlFor={`dt-${a.id}`}>Date</Label>
                        <Input id={`dt-${a.id}`} type="date" value={f.date} onChange={(e) => setF("date", e.target.value)} />
                      </div>
                      <div>
                        <Label htmlFor={`nt-${a.id}`}>Note</Label>
                        <Input id={`nt-${a.id}`} value={f.note} maxLength={120} onChange={(e) => setF("note", e.target.value)} placeholder="UPI" />
                      </div>
                    </div>
                    <Button size="sm" loading={busy === a.id} onClick={() => addFunds(a)}><Plus /> Record top-up</Button>
                    {a.entries.length ? (
                      <ul className="divide-y divide-app-border rounded-[var(--radius-control)] border border-app-border text-small">
                        {a.entries.slice(0, 8).map((e) => (
                          <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                            <span className="font-semibold text-app-text">{rupees(e.amountPaise)}</span>
                            <span className="text-app-muted">{dateFmt.format(new Date(`${e.date}T00:00:00Z`))}{e.note ? ` · ${e.note}` : ""}</span>
                            <button type="button" onClick={() => removeEntry(e.id)} aria-label="Remove entry" className="ml-auto rounded p-1 text-app-muted hover:text-red-300"><Trash2 className="size-4" aria-hidden="true" /></button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </CardBody>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader title="Meta rates (per message, ₹)" description="Used for every cost estimate: template editor, campaigns, inbox and this page. Update them when Meta changes its rate card for India." />
            <CardBody className="grid gap-4 sm:grid-cols-4">
              {(["marketing", "utility", "authentication"] as const).map((k) => (
                <div key={k}>
                  <Label htmlFor={`rate-${k}`} className="capitalize">{k}</Label>
                  <Input id={`rate-${k}`} type="number" step="0.0001" min={0} value={rates[k]} onChange={(e) => setRates((r) => ({ ...r, [k]: e.target.value }))} />
                </div>
              ))}
              <div>
                <Label htmlFor="low-alert">Warn below (₹)</Label>
                <Input id="low-alert" type="number" min={0} value={low} onChange={(e) => setLow(e.target.value)} />
              </div>
              <div className="sm:col-span-4">
                <Button size="sm" loading={busy === "rates"} onClick={saveRates}>Save rates</Button>
                <p className="mt-2 text-caption text-app-subtle">Service replies inside the 24-hour window are free. The balance counts template messages that were sent, delivered or read; failed ones are not charged.</p>
              </div>
            </CardBody>
          </Card>
        </>
      ) : null}
    </div>
  );
}
