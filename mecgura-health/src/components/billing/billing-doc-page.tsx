"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Download } from "lucide-react";
import { LabPrintButton } from "@/components/lab/lab-print-button";
import { apiFetch } from "@/lib/api/client";

/** Toolbar above a financial document: audited print (browser "Save as PDF" works) and download. Opening the page is audited too. */
export function BillingDocToolbar({ kind, id, back }: { kind: "invoice" | "receipt" | "refund" | "statement"; id: string; back?: { href: string; label: string } }) {
  useEffect(() => { apiFetch(`/api/billing/docs/${kind}/${id}`, { method: "POST", body: JSON.stringify({ access: "VIEWED" }) }); }, [kind, id]);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
      {back ? <Link href={back.href} className="type-label">← {back.label}</Link> : <span />}
      <div className="flex gap-2"><LabPrintButton auditUrl={`/api/billing/docs/${kind}/${id}`} body={{ access: "PRINTED" }} />
        <a href={`/api/billing/docs/${kind}/${id}`} className="type-button inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong px-4 !text-ink no-underline hover:bg-surface-muted"><Download aria-hidden className="size-4" />Download</a></div>
    </div>
  );
}
