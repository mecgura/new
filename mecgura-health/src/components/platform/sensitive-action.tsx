"use client";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { InviteLinkCard } from "@/components/clinic/invite-link-card";
import { Button, Modal, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import type { ButtonSize, ButtonVariant } from "@/components/ui";

export interface FieldSpec { name: string; label: string; kind?: "text" | "textarea" | "select" | "email"; options?: { value: string; label: string }[]; required?: boolean; placeholder?: string; defaultValue?: string; hint?: string }
interface Props {
  label: string; variant?: ButtonVariant; size?: ButtonSize; icon?: React.ReactNode; disabled?: boolean;
  title: string; /** WHO / WHAT this acts on */ target: string; /** plain-language consequence */ impact: string;
  endpoint: string; method?: "POST" | "PUT" | "PATCH" | "DELETE"; body?: Record<string, unknown>; fields?: FieldSpec[];
  /** ask for the Super Admin's own password (re-authentication). Default true. */
  password?: boolean; confirmLabel?: string; tone?: "danger" | "primary"; after?: "refresh" | { redirect: string }; successMessage?: string; className?: string;
}
const input = "type-form min-h-control w-full rounded-md border border-line-strong bg-surface px-3";

/**
 * The one confirmation pattern for every dangerous platform action: Action · Target · Impact · Reason · Confirm / Cancel.
 * The password is sent only to the server for re-authentication; the server decides — nothing here is a security boundary.
 */
export function SensitiveAction({ label, variant = "outline", size = "sm", icon, disabled, title, target, impact, endpoint, method = "POST", body, fields = [], password = true, confirmLabel, tone = "danger", after = "refresh", successMessage, className }: Props) {
  const router = useRouter(); const toast = useToast(); const uid = useId();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [invite, setInvite] = useState<{ token: string; expiresAt: string } | null>(null);
  function close() { setOpen(false); setErr(null); setInvite(null); }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); const values: Record<string, unknown> = {};
    for (const fld of fields) values[fld.name] = String(f.get(fld.name) ?? "").trim();
    setBusy(true); setErr(null);
    const res = await apiFetch<{ inviteToken?: string | null; inviteExpiresAt?: string | null }>(endpoint, { method, body: method === "DELETE" && !password && !fields.length ? undefined : JSON.stringify({ ...(body ?? {}), ...values, ...(password ? { password: String(f.get("confirmPassword") ?? "") } : {}) }) });
    setBusy(false);
    if (!res.ok) { setErr({ message: res.error.message, fields: res.error.fieldErrors ?? {} }); return; }
    toast({ tone: "success", title: successMessage ?? "Done" });
    if (res.data?.inviteToken) { setInvite({ token: res.data.inviteToken, expiresAt: res.data.inviteExpiresAt ?? "" }); router.refresh(); return; }
    close(); if (typeof after === "object") router.push(after.redirect); router.refresh();
  }
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} disabled={disabled} onClick={() => setOpen(true)}>{icon}{label}</Button>
      <Modal open={open} onClose={close} title={title} description={invite ? "Share this invitation link yourself — it is shown only once." : undefined}>
        {invite ? (
          <div className="space-y-3"><InviteLinkCard token={invite.token} expiresAt={invite.expiresAt} name="this person" /><div className="flex justify-end"><Button onClick={close}>Done</Button></div></div>
        ) : (
          <form onSubmit={submit} className="space-y-4" aria-label={title}>
            <dl className="grid gap-2 rounded-md bg-surface-muted p-3 sm:grid-cols-[6rem_1fr]">
              <dt className="type-caption">Action</dt><dd className="type-label">{label}</dd>
              <dt className="type-caption">Target</dt><dd className="type-body break-words">{target}</dd>
              <dt className="type-caption">Impact</dt><dd className="type-body">{impact}</dd>
            </dl>
            {fields.map((fld) => {
              const id = `${uid}-${fld.name}`; const fe = err?.fields[fld.name];
              return (
                <div key={fld.name}>
                  <label htmlFor={id} className="type-label block">{fld.label}{fld.required && <span aria-hidden className="text-danger"> *</span>}</label>
                  {fld.kind === "textarea" ? <textarea id={id} name={fld.name} required={fld.required} rows={3} maxLength={500} placeholder={fld.placeholder} defaultValue={fld.defaultValue} className={`${input} py-2`} aria-invalid={!!fe} />
                    : fld.kind === "select" ? <select id={id} name={fld.name} required={fld.required} defaultValue={fld.defaultValue} className={input} aria-invalid={!!fe}>{fld.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                    : <input id={id} name={fld.name} type={fld.kind === "email" ? "email" : "text"} required={fld.required} placeholder={fld.placeholder} defaultValue={fld.defaultValue} className={input} aria-invalid={!!fe} />}
                  {fld.hint && <p className="type-caption mt-1">{fld.hint}</p>}{fe && <p role="alert" className="type-caption mt-1 text-danger">{fe}</p>}
                </div>
              );
            })}
            {password && (
              <div>
                <label htmlFor={`${uid}-pw`} className="type-label block">Confirm with your password <span aria-hidden className="text-danger">*</span></label>
                <input id={`${uid}-pw`} name="confirmPassword" type="password" autoComplete="current-password" required className={input} aria-invalid={!!err?.fields.confirmPassword} />
                <p className="type-caption mt-1">Re-entering your own password protects against someone using an unattended session.</p>
              </div>
            )}
            {err && <p role="alert" className="type-secondary flex items-start gap-2 rounded-md bg-danger-soft p-3 text-danger"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />{err.message}</p>}
            <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={close} autoFocus>Cancel</Button><Button type="submit" variant={tone} loading={busy}>{confirmLabel ?? label}</Button></div>
          </form>
        )}
      </Modal>
    </>
  );
}
