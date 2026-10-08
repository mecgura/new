"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Receipt } from "lucide-react";
import { Button, StatusBadge, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { formatMoney } from "@/lib/billing/money";
import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TONE } from "./billing-ui";

interface St { status: string; invoiceId: string | null; invoiceNumber: string | null; totalMinor: number; dueMinor: number; currency: string | null; canCreate: boolean }
/** Billing status chip on a clinical record. Financial only: it never gates the clinical workflow. Hidden for roles without billing access. */
export function BillingStatus({ kind, id }: { kind: "consultation" | "appointment" | "investigation" | "followup"; id: string }) {
  const router = useRouter(); const toast = useToast();
  const [s, setS] = useState<St | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { apiFetch<St>(`/api/billing/status?kind=${kind}&id=${id}`).then((r) => { if (r.ok) setS(r.data); }); }, [kind, id]);
  if (!s) return null;
  async function create() {
    setBusy(true);
    const r = await apiFetch<{ id: string }>("/api/billing/invoices/from-source", { method: "POST", body: JSON.stringify({ kind, id }) });
    setBusy(false);
    if (!r.ok) { toast({ tone: "danger", title: r.error.message }); return; }
    router.push(`/billing/invoices/${r.data.id}`);
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" aria-label="Billing status">
      <Receipt aria-hidden className="size-4 text-muted" />
      <StatusBadge tone={INVOICE_STATUS_TONE[s.status] ?? "neutral"}>{INVOICE_STATUS_LABEL[s.status] ?? s.status}</StatusBadge>
      {s.invoiceId && <Link href={`/billing/invoices/${s.invoiceId}`} className="type-caption tabular-nums">{s.invoiceNumber}{s.dueMinor > 0 && s.status !== "DRAFT" ? ` · due ${formatMoney(s.dueMinor, s.currency ?? "INR")}` : ""}</Link>}
      {!s.invoiceId && s.invoiceNumber && <span className="type-caption tabular-nums">{s.invoiceNumber}</span>}
      {s.status === "NOT_BILLED" && s.canCreate && <Button size="sm" variant="outline" loading={busy} onClick={create}>Create invoice</Button>}
    </span>
  );
}
