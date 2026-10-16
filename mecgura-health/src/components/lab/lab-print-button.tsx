"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

/** Audits the print, then opens the browser print dialog ("Save as PDF" works from there). */
export function LabPrintButton({ auditUrl, body }: { auditUrl: string; body?: Record<string, unknown> }) {
  return <Button onClick={async () => { await apiFetch(auditUrl, { method: "POST", body: JSON.stringify(body ?? {}) }); window.print(); }}><Printer aria-hidden className="size-4" />Print</Button>;
}
