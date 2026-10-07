"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import { Select, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

export type SwitcherNumber = { id: string; displayName: string; phoneNumber: string; isDemo: boolean };

/** Chooses which WhatsApp number the dashboard (and the inbox / new campaigns / new automations) default to. */
export function NumberSwitcher({ orgId, numbers, activeId }: { orgId: string; numbers: SwitcherNumber[]; activeId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = React.useState(activeId);
  const [busy, setBusy] = React.useState(false);
  if (numbers.length < 2) return null;
  async function change(id: string) {
    setValue(id);
    setBusy(true);
    const r = await apiFetch(`/api/organizations/${orgId}/whatsapp/active`, { method: "PUT", body: { accountId: id } });
    setBusy(false);
    if (!r.ok) {
      setValue(activeId);
      return toast(r.error, "error");
    }
    router.refresh();
  }
  return (
    <div className="flex items-center gap-2">
      <Phone className="size-4 text-app-subtle" aria-hidden="true" />
      <Select aria-label="Active WhatsApp number" value={value} disabled={busy} onChange={(e) => void change(e.target.value)} className="h-9 w-64 max-w-full text-small">
        <option value="">All numbers ({numbers.length})</option>
        {numbers.map((n) => (
          <option key={n.id} value={n.id}>
            {n.displayName} · {n.phoneNumber}
            {n.isDemo ? " (demo)" : ""}
          </option>
        ))}
      </Select>
    </div>
  );
}
