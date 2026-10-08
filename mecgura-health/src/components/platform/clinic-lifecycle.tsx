"use client";
import { Archive, ArchiveRestore, PauseCircle, PlayCircle, Power, ShieldCheck } from "lucide-react";
import { TRANSITIONS } from "@/lib/platform/lifecycle";
import { SensitiveAction, type FieldSpec } from "./sensitive-action";

const CATEGORY: FieldSpec = { name: "category", label: "Reason category", kind: "select", required: true, options: [{ value: "ADMINISTRATIVE", label: "Administrative" }, { value: "SECURITY", label: "Security" }, { value: "TECHNICAL", label: "Technical" }, { value: "CONTRACTUAL", label: "Contractual" }, { value: "OTHER", label: "Other" }] };
const NOTES: FieldSpec = { name: "notes", label: "Reason / notes", kind: "textarea", required: true, placeholder: "Why is this being done?" };

/** Lifecycle buttons offered for a clinic's current status. The server re-checks every transition. */
export function ClinicLifecycle({ id, name, status }: { id: string; name: string; status: string }) {
  const ep = `/api/platform/clinics/${id}/lifecycle`;
  const can = (a: keyof typeof TRANSITIONS) => TRANSITIONS[a].from.includes(status);
  const common = { target: name, endpoint: ep } as const;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Clinic lifecycle">
      {can("activate") && <SensitiveAction {...common} label={status === "PENDING" ? "Activate clinic" : "Reactivate"} icon={<PlayCircle aria-hidden className="size-4" />} variant="primary" size="md" tone="primary" password={false} title={`Activate ${name}?`} impact={TRANSITIONS.activate.impact} body={{ action: "activate" }} fields={[{ name: "notes", label: "Notes (optional)", kind: "textarea" }]} successMessage="Clinic activated" confirmLabel="Activate" />}
      {can("suspend") && <SensitiveAction {...common} label="Suspend" icon={<PauseCircle aria-hidden className="size-4" />} size="md" title={`Suspend ${name}?`} impact={TRANSITIONS.suspend.impact} body={{ action: "suspend" }} fields={[CATEGORY, NOTES]} successMessage="Clinic suspended" />}
      {can("deactivate") && <SensitiveAction {...common} label="Deactivate" icon={<Power aria-hidden className="size-4" />} size="md" title={`Deactivate ${name}?`} impact={TRANSITIONS.deactivate.impact} body={{ action: "deactivate" }} fields={[CATEGORY, NOTES]} successMessage="Clinic deactivated" />}
      {can("archive") && <SensitiveAction {...common} label="Archive" icon={<Archive aria-hidden className="size-4" />} size="md" title={`Archive ${name}?`} impact={TRANSITIONS.archive.impact} body={{ action: "archive" }} fields={[CATEGORY, NOTES]} successMessage="Clinic archived" />}
      {can("restore") && <SensitiveAction {...common} label="Restore" icon={<ArchiveRestore aria-hidden className="size-4" />} variant="outline" size="md" tone="primary" title={`Restore ${name}?`} impact={TRANSITIONS.restore.impact} body={{ action: "restore" }} fields={[CATEGORY, NOTES]} successMessage="Clinic restored" />}
      <SensitiveAction {...common} endpoint="/api/platform/workspace" label="Open clinic workspace" icon={<ShieldCheck aria-hidden className="size-4" />} variant="outline" size="md" tone="primary" title={`Open ${name} as Super Admin?`} impact="You will work inside this clinic's workspace for up to 60 minutes. A banner marks the visit, and the reason and every action are recorded in the audit log." body={{ tenantId: id }} fields={[{ name: "reason", label: "Reason for support access", kind: "textarea", required: true, placeholder: "e.g. Investigating a reported booking problem", hint: "At least 10 characters." }]} after={{ redirect: "/dashboard" }} successMessage="Support access started" confirmLabel="Start support access" />
    </div>
  );
}
