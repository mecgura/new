"use client";

import * as React from "react";
import { Alert, Button, Card, CardBody, CardHeader, ConfirmationDialog, Field, Input, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatINR } from "@/lib/catalog";
import { FeeEditor } from "@/components/wallet/fee-editor";
import { WalletBalance, WalletLedger, WalletLoading, useWallet } from "@/components/wallet/wallet-parts";

/** Super Admin: add money received from the client, take back a mistaken credit, set the low-balance alert. */
export function AdminWallet({ organizationId }: { organizationId: string }) {
  const url = `/api/admin/organizations/${organizationId}/wallet`;
  const toast = useToast();
  const { data, error, load, setPage } = useWallet(url);
  const [form, setForm] = React.useState({ amount: "", reference: "", note: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [confirmDebit, setConfirmDebit] = React.useState(false);
  const [alertAt, setAlertAt] = React.useState("");
  // One id per form fill: a double tap or a retry can never apply the same movement twice.
  const key = React.useRef<string>("");

  async function submit(direction: "credit" | "debit") {
    const amount = Number(form.amount);
    if (!form.amount.trim() || !Number.isFinite(amount) || amount <= 0) return setErrors({ amount: "Enter an amount above zero" });
    setBusy(true);
    setErrors({});
    key.current ||= crypto.randomUUID();
    const r = await apiFetch(url, { method: "POST", body: { direction, amountRupees: amount, reference: form.reference, note: form.note, idempotencyKey: key.current } });
    setBusy(false);
    setConfirmDebit(false);
    if (!r.ok) return setErrors({ amount: r.details?.amountRupees?.[0] ?? r.error });
    key.current = "";
    setForm({ amount: "", reference: "", note: "" });
    toast(direction === "credit" ? `${formatINR(Math.round(amount * 100))} added to the wallet` : `${formatINR(Math.round(amount * 100))} deducted`);
    void load();
  }

  async function saveAlert() {
    const n = Number(alertAt || "0");
    if (!Number.isFinite(n) || n < 0) return;
    const r = await apiFetch(url, { method: "PATCH", body: { lowBalanceRupees: n } });
    if (!r.ok) return toast(r.error, "error");
    toast("Low-balance alert saved");
    setAlertAt("");
    void load();
  }

  if (!data) return <WalletLoading error={error} onRetry={load} />;
  return (
    <div className="space-y-4">
      <WalletBalance wallet={data.wallet} />
      <Card>
        <CardHeader title="Add or deduct" description="Add money after the client has paid you (UPI / bank). Keep the payment reference so the entry can be matched to your bank statement." />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="wallet-amount" label="Amount (₹)" error={errors.amount}>
              <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="5000" />
            </Field>
            <Field id="wallet-ref" label="Payment reference">
              <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} maxLength={100} placeholder="UPI / bank ref" />
            </Field>
            <Field id="wallet-note" label="Note">
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={300} placeholder="Optional" />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button loading={busy} onClick={() => void submit("credit")}>
              Add money
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => (Number(form.amount) > 0 ? setConfirmDebit(true) : setErrors({ amount: "Enter an amount above zero" }))}>
              Deduct
            </Button>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Low-balance alert" description={data.wallet.lowBalanceThreshold ? `Currently ${formatINR(data.wallet.lowBalanceThreshold)}. The client's owners are notified when the balance falls to this level.` : "Off. Set an amount to notify the client's owners when the balance gets low."} />
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <Field id="wallet-alert" label="Alert at or below (₹)">
              <Input inputMode="decimal" value={alertAt} onChange={(e) => setAlertAt(e.target.value)} placeholder={String(data.wallet.lowBalanceThreshold / 100)} />
            </Field>
            <Button variant="secondary" onClick={() => void saveAlert()} disabled={!alertAt.trim()}>
              Save
            </Button>
          </div>
        </CardBody>
      </Card>
      <FeeEditor url={`${url}/prices`} scope="client" />
      <Alert tone="info">This is prepaid MECGURA service credit. It does not pay Meta: the client&apos;s WhatsApp message charges are billed by Meta to their own WhatsApp Business account.</Alert>
      <WalletLedger data={data} onPage={setPage} />
      <ConfirmationDialog
        open={confirmDebit}
        onClose={() => setConfirmDebit(false)}
        onConfirm={() => void submit("debit")}
        loading={busy}
        title="Deduct from wallet?"
        description={`${formatINR(Math.round(Number(form.amount || 0) * 100))} will be taken from this client's wallet and recorded as a correction.`}
        confirmLabel="Deduct"
      />
    </div>
  );
}
