"use client";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

export function PrintButton({ consultationId, version }: { consultationId: string; version: number }) {
  return (
    <div className="flex gap-2">
      <Button onClick={async () => { await apiFetch(`/api/consultations/${consultationId}/prescription/print`, { method: "POST", body: JSON.stringify({ version }) }); window.print(); }}><Printer aria-hidden className="size-4" />Print</Button>
      <a href={`/api/consultations/${consultationId}/prescription/document?version=${version}`} className="type-button inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong px-4 !text-ink no-underline hover:bg-surface-muted"><Download aria-hidden className="size-4" />Download</a>
    </div>
  );
}
