"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

/** Shown on every page while a Super Admin is inside a client workspace (support access). */
export function SupportBanner({ orgName }: { orgName: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  async function exit() {
    setBusy(true);
    await apiFetch("/api/admin/exit-workspace", { method: "POST" });
    router.push("/admin/clients");
    router.refresh();
  }
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-small text-app-text">
      <span className="flex items-center gap-2">
        <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
        <span>
          You are inside <strong>{orgName}</strong>&apos;s workspace as Super Admin. Everything you do here is recorded in the audit log.
        </span>
      </span>
      <Button variant="secondary" onClick={exit} disabled={busy}>
        {busy ? "Leaving…" : "Exit to admin"}
      </Button>
    </div>
  );
}
