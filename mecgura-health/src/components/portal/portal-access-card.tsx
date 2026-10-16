"use client";
import { useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Modal, useToast } from "@/components/ui";
import { useApi } from "@/components/patients/use-api";
import { apiFetch } from "@/lib/api/client";

interface Access { enabled: boolean; hasContact: boolean; account: { status: string; lastLoginAt: string | null; createdAt: string; loginWith: string } | null; pendingInvite: { expiresAt: string; purpose: string } | null }
/** Staff card on the patient file: give the patient portal access (a one-time code you hand to them), reset it, or suspend it. Hidden for roles without portal permission. */
export function PortalAccessCard({ patientId, patientName }: { patientId: string; patientName: string }) {
  const toast = useToast(); const { data, error, reload } = useApi<Access>(`/api/portal/staff/access/${patientId}`);
  const [code, setCode] = useState<{ code: string; hours: number; purpose: string } | null>(null); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState<"suspend" | "reactivate" | null>(null); const [msg, setMsg] = useState<string>();
  if (error || !data) return null; // not permitted (or loading): nothing to show
  async function act(action: "invite" | "suspend" | "reactivate") {
    setBusy(true); setMsg(undefined); const r = await apiFetch<{ code: string; hours: number; purpose: string }>(`/api/portal/staff/access/${patientId}`, { method: "POST", body: JSON.stringify({ action }) }); setBusy(false);
    if (!r.ok) { setMsg(r.error.message); setConfirm(null); return; }
    if (action === "invite") setCode(r.data); else toast({ tone: "success", title: action === "suspend" ? "Portal access suspended" : "Portal access restored" }); setConfirm(null); await reload();
  }
  const acc = data.account;
  return (
    <Card><CardHeader title="Patient portal access" description="Lets the patient see their own appointments, prescriptions, reports and bills online." action={acc ? <Badge tone={acc.status === "ACTIVE" ? "success" : "warning"}>{acc.status.toLowerCase()}</Badge> : <Badge>not activated</Badge>} />
      <CardBody className="space-y-3">
        {msg && <Alert tone="danger">{msg}</Alert>}
        {!data.enabled && <Alert tone="warning">The portal is switched off for this clinic (Settings → Patient portal).</Alert>}
        {!data.hasContact && <Alert tone="warning">Add the patient&apos;s mobile number or email first — they confirm their identity with it.</Alert>}
        {acc && <p className="type-secondary">Signs in with their {acc.loginWith}. {acc.lastLoginAt ? `Last sign-in ${new Date(acc.lastLoginAt).toLocaleDateString("en-IN")}.` : "Has not signed in yet."}</p>}
        {data.pendingInvite && <p className="type-secondary">A {data.pendingInvite.purpose === "ACCESS_RESET" ? "reset" : "activation"} code is waiting (expires {new Date(data.pendingInvite.expiresAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}).</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => act("invite")} loading={busy} disabled={!data.enabled || !data.hasContact}><KeyRound aria-hidden className="size-4" />{acc ? "Reset access (new code)" : "Create activation code"}</Button>
          {acc && acc.status === "ACTIVE" && <Button size="sm" variant="outline" onClick={() => setConfirm("suspend")}>Suspend access</Button>}
          {acc && acc.status === "SUSPENDED" && <Button size="sm" variant="outline" onClick={() => setConfirm("reactivate")}>Restore access</Button>}
        </div>
        <p className="type-caption">Codes are shown once, work once and expire after 3 days. Nothing is sent to the patient automatically — give the code to them in person or by a channel you trust.</p>
      </CardBody>
      {code && (
        <Modal open onClose={() => setCode(null)} title={code.purpose === "ACCESS_RESET" ? "Access reset code" : "Activation code"} description={`For ${patientName}. Valid for ${code.hours} hours, single use.`} footer={<Button onClick={() => setCode(null)}>Done</Button>}>
          <div className="space-y-3 text-center"><p className="text-3xl font-bold tracking-widest tabular-nums" aria-label={`Code ${code.code}`}>{code.code}</p>
            <Button variant="outline" onClick={async () => { await navigator.clipboard?.writeText(code.code); toast({ tone: "success", title: "Copied" }); }}><Copy aria-hidden className="size-4" />Copy</Button>
            <Alert tone="warning">This code is not shown again. The patient opens the clinic&apos;s portal → “Activate my account”, enters this code and the mobile number or email you have on file.</Alert></div>
        </Modal>
      )}
      <ConfirmDialog open={!!confirm} onCancel={() => setConfirm(null)} onConfirm={() => act(confirm!)} loading={busy} tone={confirm === "suspend" ? "danger" : "primary"} title={confirm === "suspend" ? "Suspend portal access?" : "Restore portal access?"} description={confirm === "suspend" ? "The patient is signed out everywhere and can't sign in until you restore access." : "The patient can sign in again with their existing password."} confirmLabel={confirm === "suspend" ? "Suspend" : "Restore"} />
    </Card>
  );
}
