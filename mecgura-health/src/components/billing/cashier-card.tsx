"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, CardBody, CardHeader, Field, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { formatMoney, moneyToMinor } from "@/lib/billing/money";
import { stamp } from "./billing-ui";

/** Optional cashier session (only when the clinic switched it on in billing settings). */
export function CashierCard() {
  const toast = useToast();
  const [s, setS] = useState<{ enabled: boolean; session: { openedAt: string; openingMinor: number } | null } | null>(null);
  const [amt, setAmt] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  const load = useCallback(async () => { const r = await apiFetch<NonNullable<typeof s>>("/api/billing/session"); if (r.ok) setS(r.data); }, []);
  useEffect(() => { load(); }, [load]);
  if (!s || !s.enabled) return null;
  async function go(action: "open" | "close") {
    const minor = moneyToMinor(amt || "0"); if (minor == null) { setErr("Enter a valid amount."); return; }
    setBusy(true); setErr(undefined);
    const r = await apiFetch<{ expectedMinor?: number; differenceMinor?: number }>("/api/billing/session", { method: "POST", body: JSON.stringify(action === "open" ? { action, openingMinor: minor } : { action, closingMinor: minor }) });
    setBusy(false);
    if (!r.ok) { setErr(r.error.message); return; }
    toast({ tone: "success", title: action === "open" ? "Session opened" : `Session closed. Expected ${formatMoney(r.data.expectedMinor ?? 0)}, difference ${formatMoney(r.data.differenceMinor ?? 0)}` });
    setAmt(""); await load();
  }
  return (
    <Card><CardHeader title="Cashier session" description={s.session ? `Open since ${stamp(s.session.openedAt)} · opening ${formatMoney(s.session.openingMinor)}` : "Open a session before taking cash."} />
      <CardBody className="flex flex-wrap items-end gap-3">{err && <Alert tone="danger">{err}</Alert>}
        <Field label={s.session ? "Cash counted at close" : "Opening cash"}><TextInput value={amt} inputMode="decimal" onChange={(e) => setAmt(e.target.value)} placeholder="0.00" /></Field>
        <Button loading={busy} onClick={() => go(s.session ? "close" : "open")}>{s.session ? "Close session" : "Open session"}</Button></CardBody></Card>
  );
}
