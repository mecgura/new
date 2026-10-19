"use client";

import * as React from "react";
import { Alert, Button, Card, CardBody, CardHeader, ErrorState, Field, Input, LoadingState, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatINR } from "@/lib/catalog";

export const FEE_LABELS = {
  marketing: "Marketing template",
  utility: "Utility template",
  authentication: "Authentication (OTP) template",
  service: "Service reply (inside the 24-hour window)",
} as const;
type Cat = keyof typeof FEE_LABELS;
const CATS = Object.keys(FEE_LABELS) as Cat[];
type Prices = Record<Cat, number>;
type Card = { defaults: Prices; overrides: Partial<Prices>; effective: Prices };

const toRupees = (paise: number) => String(paise / 100);

/**
 * Admin editor for MECGURA's per-message service fee. `default` edits the fee every client pays; `client` edits one
 * client's own fee (an empty box uses the default). Prices are in rupees per message; empty = free (default) / use default.
 */
export function FeeEditor({ url, scope }: { url: string; scope: "default" | "client" }) {
  const toast = useToast();
  const [card, setCard] = React.useState<Card | null>(null);
  const [error, setError] = React.useState("");
  const [form, setForm] = React.useState<Record<Cat, string>>({ marketing: "", utility: "", authentication: "", service: "" });
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ prices?: Prices; card?: Card }>(url);
    if (!r.ok) return setError(r.error);
    const c: Card = r.data.card ?? { defaults: r.data.prices!, overrides: r.data.prices!, effective: r.data.prices! };
    setError("");
    setCard(c);
    const source = scope === "default" ? c.defaults : c.overrides;
    setForm({
      marketing: source.marketing ? toRupees(source.marketing) : "",
      utility: source.utility ? toRupees(source.utility) : "",
      authentication: source.authentication ? toRupees(source.authentication) : "",
      service: source.service ? toRupees(source.service) : "",
    });
  }, [url, scope]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function save() {
    const body: Record<string, number | null> = {};
    for (const cat of CATS) {
      const raw = form[cat].trim();
      if (raw === "") body[cat] = null;
      else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return toast(`${FEE_LABELS[cat]}: enter 0 or a positive amount`, "error");
        body[cat] = n;
      }
    }
    setBusy(true);
    const r = await apiFetch(url, { method: "PUT", body });
    setBusy(false);
    if (!r.ok) return toast(r.details ? Object.values(r.details).flat()[0] ?? r.error : r.error, "error");
    toast("Message fees saved");
    void load();
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!card) return <LoadingState />;
  return (
    <Card>
      <CardHeader
        title={scope === "default" ? "Default message fees" : "Message fees for this client"}
        description={
          scope === "default"
            ? "What MECGURA charges from a client's wallet for each WhatsApp message. Leave a box empty for free. A client can have its own fee on its Wallet tab."
            : "Overrides the default for this client only. Leave a box empty to use the default."
        }
      />
      <CardBody>
        <div className="grid gap-4 sm:grid-cols-2">
          {CATS.map((cat) => (
            <Field key={cat} id={`fee-${scope}-${cat}`} label={`${FEE_LABELS[cat]} (₹ per message)`} hint={scope === "client" ? `Default: ${card.defaults[cat] ? formatINR(card.defaults[cat]) : "free"}` : undefined}>
              <Input inputMode="decimal" value={form[cat]} onChange={(e) => setForm({ ...form, [cat]: e.target.value })} placeholder={scope === "client" ? (card.defaults[cat] ? toRupees(card.defaults[cat]) : "0") : "0"} />
            </Field>
          ))}
        </div>
        <Alert tone="info" className="mt-4">
          These are MECGURA&apos;s fees only. Meta&apos;s own message charges are billed by Meta to the client&apos;s WhatsApp Business account. From 1 Oct 2026 Meta also charges for service replies.
        </Alert>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => void save()} loading={busy}>
            Save fees
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
