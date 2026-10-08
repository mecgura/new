"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, StatusBadge, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { SensitiveAction } from "./sensitive-action";

/** One feature row. Turning OFF is a confirmed, reasoned, re-authenticated action; turning ON is immediate. Data is never deleted either way. */
export function FeatureSwitch({ clinicId, clinicName, feature }: { clinicId: string; clinicName: string; feature: { key: string; label: string; description: string; enabled: boolean; critical: boolean; group: string } }) {
  const router = useRouter(); const toast = useToast(); const [busy, setBusy] = useState(false);
  async function enable() {
    setBusy(true); const res = await apiFetch(`/api/platform/clinics/${clinicId}/features`, { method: "PUT", body: JSON.stringify({ key: feature.key, enabled: true }) }); setBusy(false);
    if (!res.ok) return toast({ tone: "danger", title: "Couldn't turn it on", description: res.error.message });
    toast({ tone: "success", title: `${feature.label} is on` }); router.refresh();
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0"><p className="type-label">{feature.label} <StatusBadge tone={feature.enabled ? "success" : "neutral"}>{feature.enabled ? "On" : "Off"}</StatusBadge></p><p className="type-caption">{feature.description}</p></div>
      {feature.enabled
        ? <SensitiveAction label="Turn off" title={`Turn off ${feature.label}?`} target={`${feature.label} · ${clinicName}`} impact={`${feature.label} is hidden and blocked for this clinic on the server.${feature.critical ? " Many other modules depend on it, so parts of the clinic will stop working." : ""} Existing data is kept and returns when you turn it back on.`} endpoint={`/api/platform/clinics/${clinicId}/features`} method="PUT" body={{ key: feature.key, enabled: false }} fields={[{ name: "notes", label: "Reason", kind: "textarea", required: true }]} successMessage={`${feature.label} turned off`} />
        : <Button size="sm" variant="outline" onClick={enable} loading={busy} aria-label={`Turn on ${feature.label}`}>Turn on</Button>}
    </li>
  );
}
