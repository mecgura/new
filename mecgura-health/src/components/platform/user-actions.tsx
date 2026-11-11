"use client";
import { KeyRound, ShieldCheck, UserCheck, UserMinus, UserPlus, UserCog } from "lucide-react";
import { ROLE_LABELS, TENANT_ASSIGNABLE_ROLES, type RoleKey } from "@/lib/permissions";
import { SensitiveAction } from "./sensitive-action";

const roleOptions = TENANT_ASSIGNABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r as RoleKey] ?? r }));
export function UserActions({ id, name, status, role, clinic }: { id: string; name: string; status: string; role: string; clinic: string }) {
  const ep = `/api/platform/users/${id}`; const target = `${name} · ${clinic}`;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Actions for ${name}`}>
      {status === "ACTIVE" || status === "SUSPENDED" ? null : status === "DISABLED" ? <SensitiveAction label="Activate" icon={<UserCheck aria-hidden className="size-4" />} tone="primary" password={false} title={`Activate ${name}?`} target={target} impact="The person can sign in again with their existing password." endpoint={ep} body={{ action: "status", status: "ACTIVE" }} successMessage="Account activated" /> : null}
      {status === "SUSPENDED" && <SensitiveAction label="Activate" icon={<UserCheck aria-hidden className="size-4" />} tone="primary" password={false} title={`Activate ${name}?`} target={target} impact="The person can sign in again." endpoint={ep} body={{ action: "status", status: "ACTIVE" }} successMessage="Account activated" />}
      {status === "ACTIVE" && <>
        <SensitiveAction label="Suspend" icon={<UserMinus aria-hidden className="size-4" />} title={`Suspend ${name}?`} target={target} impact="They are signed out on their next request and cannot sign in until re-activated. Their records and history are kept." endpoint={ep} body={{ action: "status", status: "SUSPENDED" }} fields={[{ name: "notes", label: "Reason", kind: "textarea", required: true }]} successMessage="Account suspended" />
        <SensitiveAction label="Deactivate" icon={<UserMinus aria-hidden className="size-4" />} title={`Deactivate ${name}?`} target={target} impact="The account is switched off. Nothing is deleted; audit history stays attached to the person." endpoint={ep} body={{ action: "status", status: "DISABLED" }} fields={[{ name: "notes", label: "Reason", kind: "textarea", required: true }]} successMessage="Account deactivated" />
      </>}
      <SensitiveAction label="Change role" icon={<UserCog aria-hidden className="size-4" />} title={`Change ${name}'s role?`} target={`${target} · now ${ROLE_LABELS[role as RoleKey] ?? role}`} impact="Their permissions change immediately. Extra permissions granted for the old role are removed. Platform-admin roles cannot be assigned here." endpoint={ep} body={{ action: "role" }} fields={[{ name: "role", label: "New role", kind: "select", required: true, options: roleOptions, defaultValue: role }, { name: "notes", label: "Reason", kind: "textarea", required: true }]} tone="primary" successMessage="Role changed" />
      <SensitiveAction label="Reset access" icon={<KeyRound aria-hidden className="size-4" />} title={`Reset ${name}'s access?`} target={target} impact="Unlocks the account. If they have not accepted their invitation yet, the old invitation is cancelled and a new single-use link is created (shown once)." endpoint={ep} body={{ action: "reset" }} tone="primary" successMessage="Access reset" />
    </div>
  );
}

export function InviteUser({ clinicId, clinicName }: { clinicId: string; clinicName: string }) {
  return <SensitiveAction label="Invite person" icon={<UserPlus aria-hidden className="size-4" />} variant="primary" size="md" tone="primary" password={false} title={`Invite someone to ${clinicName}`} target={clinicName} impact="Creates an account in INVITED state and a single-use invitation link that expires in 7 days. No email is sent — you share the link." endpoint={`/api/platform/clinics/${clinicId}/users`} fields={[{ name: "name", label: "Full name", required: true }, { name: "email", label: "Email", kind: "email", required: true }, { name: "phone", label: "Phone (optional)", hint: "With country code, e.g. +919876543210" }, { name: "role", label: "Role", kind: "select", required: true, options: roleOptions, defaultValue: "RECEPTIONIST" }]} confirmLabel="Create invitation" successMessage="Invitation created" />;
}

export function AdminHandoff({ clinicId, clinicName, candidates }: { clinicId: string; clinicName: string; candidates: { id: string; name: string; role: string }[] }) {
  return <SensitiveAction label="Change clinic admin" icon={<ShieldCheck aria-hidden className="size-4" />} size="md" title={`Change the clinic admin of ${clinicName}?`} target={clinicName} impact="The chosen active staff member becomes Clinic Admin. Previous admins keep their account; you can also move them to another role. The change and the previous admins are recorded." endpoint={`/api/platform/clinics/${clinicId}/admin`} disabled={!candidates.length} fields={[{ name: "userId", label: "New admin", kind: "select", required: true, options: candidates.map((c) => ({ value: c.id, label: `${c.name} (${ROLE_LABELS[c.role as RoleKey] ?? c.role})` })) }, { name: "demotePreviousTo", label: "Previous admin(s) become", kind: "select", options: [{ value: "", label: "Stay Clinic Admin" }, ...roleOptions.filter((r) => r.value !== "CLINIC_ADMIN")] }, { name: "notes", label: "Reason", kind: "textarea", required: true }]} successMessage="Clinic admin changed" />;
}
