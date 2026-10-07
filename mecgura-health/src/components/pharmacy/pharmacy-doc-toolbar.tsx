"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Download } from "lucide-react";
import { LabPrintButton } from "@/components/lab/lab-print-button";
import { apiFetch } from "@/lib/api/client";

/** Toolbar above a pharmacy document: audited print ("Save as PDF" works from the print dialog) and download. Opening the page is audited too. */
export function PharmacyDocToolbar({ kind, id, back }: { kind: string; id: string; back: { href: string; label: string } }) {
  useEffect(() => { apiFetch(`/api/pharmacy/docs/${kind}/${id}`, { method: "POST", body: JSON.stringify({ access: "VIEWED" }) }); }, [kind, id]);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
      <Link href={back.href} className="type-label">← {back.label}</Link>
      <div className="flex gap-2"><LabPrintButton auditUrl={`/api/pharmacy/docs/${kind}/${id}`} body={{ access: "PRINTED" }} />
        <a href={`/api/pharmacy/docs/${kind}/${id}`} className="type-button inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong px-4 !text-ink no-underline hover:bg-surface-muted"><Download aria-hidden className="size-4" />Download</a></div>
    </div>
  );
}
