"use client";

import * as React from "react";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Mode = "client_pays" | "prepaid_wallet" | "package";
type Rates = { marketing: number; utility: number; authentication: number };
type Resp = { billing: { mode: Mode; markupPaise: number }; rates: Rates };

const OPTIONS: { mode: Mode; title: string; text: string }[] = [
  { mode: "client_pays", title: "Client pays Meta", text: "The client adds their own card in Meta Billing on their WhatsApp Business account. Meta bills them directly. No risk for you." },
  { mode: "package", title: "Message package", text: "Your card is on the client's WhatsApp account. The plan includes a monthly number of marketing and utility messages; extra needs a top-up pack. Set the numbers on the plan (Billing & Plans)." },
  { mode: "prepaid_wallet", title: "Prepaid wallet", text: "Your card is on the client's WhatsApp account. The client recharges the MECGURA wallet and each template message is deducted at Meta's rate + your markup." },
];
const rs = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

/** Super Admin: choose who pays Meta for this client's WhatsApp messages. Prepaid sets wallet prices to Meta rate + markup. */
export function MetaBillingCard({ organizationId, onSaved }: { organizationId: string; onSaved?: () => void }) {
  const url = `/api/admin/organizations/${organizationId}/meta-billing`;
  const toast = useToast();
  const [data, setData] = React.useState<Resp | null>(null);
  const [mode, setMode] = React.useState<Mode>("client_pays");
  const [markup, setMarkup] = React.useState("0.20");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    void apiFetch<Resp>(url).then((r) => {
      if (!r.ok) return;
      setData(r.data);
      setMode(r.data.billing.mode);
      setMarkup((r.data.billing.markupPaise / 100).toFixed(2));
    });
  }, [url]);

  async function save() {
    setBusy(true);
    const r = await apiFetch<Resp>(url, { method: "PUT", body: { mode, markupRupees: Number(markup || 0) } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setData(r.data);
    toast(mode === "prepaid_wallet" ? "Prepaid wallet on. Message prices updated." : mode === "package" ? "Message package on. Messages come out of the plan allowance." : "Client pays Meta. Wallet prices reset.");
    onSaved?.();
  }

  if (!data) return null;
  const m = Math.round(Number(markup || 0) * 100);
  return (
    <Card>
      <CardHeader title="Meta billing type" description="Who pays Meta for this client's WhatsApp messages." />
      <CardBody>
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Meta billing type">
          {OPTIONS.map((o) => (
            <button
              key={o.mode}
              type="button"
              role="radio"
              aria-checked={mode === o.mode}
              onClick={() => setMode(o.mode)}
              className={`rounded-xl border p-4 text-left transition ${mode === o.mode ? "border-app-primary bg-app-primary/10" : "border-app-border hover:bg-app-hover"}`}
            >
              <p className="font-semibold text-app-text">{o.title}</p>
              <p className="mt-1 text-small text-app-muted">{o.text}</p>
            </button>
          ))}
        </div>
        {mode === "prepaid_wallet" ? (
          <div className="mt-4 space-y-3">
            <Field id="meta-markup" label="Your markup per message (₹)">
              <Input inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value.replace(/[^\d.]/g, ""))} className="w-32" />
            </Field>
            <div className="grid gap-2 sm:grid-cols-3">
              {(["marketing", "utility", "authentication"] as const).map((c) => (
                <div key={c} className="rounded-lg border border-app-border p-3">
                  <p className="text-caption capitalize text-app-muted">{c}</p>
                  <p className="font-semibold text-app-text">{rs(Math.round(data.rates[c] + m))} / msg</p>
                  <p className="text-caption text-app-subtle">Meta {rs(data.rates[c])} + you {rs(m)}</p>
                </div>
              ))}
            </div>
            <Alert tone="warning">Meta bills your card for this client&apos;s messages. Set a low-balance alert and keep Meta rates current in Admin → Meta balance; prices here update automatically when you change them.</Alert>
          </div>
        ) : null}
        <div className="mt-4">
          <Button loading={busy} onClick={() => void save()} disabled={mode === data.billing.mode && (mode !== "prepaid_wallet" || m === data.billing.markupPaise)}>
            Save billing type
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
