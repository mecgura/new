"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

/** Toolbar above one of the patient's documents. Opening, printing and downloading are audited; the file is served by an authorised endpoint only. */
export function PortalDocToolbar({ kind, id, back }: { kind: string; id: string; back: { href: string; label: string } }) {
  useEffect(() => { void apiFetch(`/api/patient/docs/${kind}/${id}`, { method: "POST", body: JSON.stringify({ access: "VIEWED" }) }); }, [kind, id]);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
      <Link href={back.href} className="type-label inline-flex min-h-11 items-center">← {back.label}</Link>
      <div className="flex gap-2">
        <Button variant="outline" onClick={async () => { await apiFetch(`/api/patient/docs/${kind}/${id}`, { method: "POST", body: JSON.stringify({ access: "PRINTED" }) }); window.print(); }}><Printer aria-hidden className="size-4" />Print</Button>
        <a href={`/api/patient/docs/${kind}/${id}`} className="type-button inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong px-4 !text-ink no-underline hover:bg-surface-muted"><Download aria-hidden className="size-4" />Download</a>
      </div>
    </div>
  );
}
