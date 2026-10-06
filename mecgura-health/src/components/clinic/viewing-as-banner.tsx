"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";

/** Shown whenever a Super Admin is inside a clinic workspace, so actions there are never accidental. */
export function ViewingAsBanner({ clinicName }: { clinicName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function exit() {
    setBusy(true);
    const res = await apiFetch("/api/platform/workspace", { method: "DELETE" });
    if (!res.ok) { toast({ tone: "danger", title: "Couldn't exit", description: res.error.message }); setBusy(false); return; }
    router.push("/platform/clinics");
    router.refresh();
  }
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5">
      <ShieldAlert aria-hidden className="size-5 shrink-0 text-warning" />
      <p className="type-label min-w-0 flex-1">Viewing as Super Admin <span className="font-normal text-muted">— you are inside <strong className="text-ink">{clinicName}</strong>. Actions here affect this clinic and are logged.</span></p>
      <Button size="sm" variant="outline" onClick={exit} loading={busy}>Exit clinic</Button>
    </div>
  );
}
