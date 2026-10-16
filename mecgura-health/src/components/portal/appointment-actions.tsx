"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button, ConfirmDialog, Field, LoadingState, Modal, TextInput, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { dayLabel } from "./portal-labels";

interface SlotRes { slots: { startsAt: string; label: string }[]; message: string }
/** Cancel / reschedule the patient's own appointment. The server re-checks ownership, the clinic's policy and the cut-off time. */
export function AppointmentActions({ id, canCancel, canReschedule, status, doctorHandle }: { id: string; canCancel: boolean; canReschedule: boolean; status: string; doctorHandle?: string }) {
  const router = useRouter(); const toast = useToast(); const [cancel, setCancel] = useState(false); const [resched, setResched] = useState(false); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>();
  const [date, setDate] = useState(""); const [slots, setSlots] = useState<SlotRes | null>(null); const [slot, setSlot] = useState(""); const [loading, setLoading] = useState(false); 
  useEffect(() => {
    if (!resched || !date || !doctorHandle) return; let live = true;
    const t = setTimeout(async () => { setLoading(true); setSlot(""); const r = await apiFetch<SlotRes>(`/api/patient/booking/slots?doctor=${encodeURIComponent(doctorHandle)}&date=${date}`); if (!live) return; setLoading(false); if (r.ok) { setSlots(r.data); setMsg(undefined); } else { setSlots(null); setMsg(r.error.message); } }, 0);
    return () => { live = false; clearTimeout(t); };
  }, [resched, date, doctorHandle]);
  if (!["REQUESTED", "CONFIRMED"].includes(status)) return <p className="type-secondary">This appointment can no longer be changed online.</p>;
  if (!canCancel && !canReschedule) return <p className="type-caption">Online changes aren&apos;t available for this appointment. Please call the clinic.</p>;
  async function doCancel() { setBusy(true); setMsg(undefined); const r = await apiFetch(`/api/patient/appointments/${id}/cancel`, { method: "POST", body: JSON.stringify({}) }); setBusy(false); if (!r.ok) { setMsg(r.error.message); setCancel(false); return; } toast({ tone: "success", title: "Appointment cancelled" }); setCancel(false); router.refresh(); }
  async function doResched() { setBusy(true); setMsg(undefined); const r = await apiFetch(`/api/patient/appointments/${id}/reschedule`, { method: "POST", body: JSON.stringify({ startsAt: slot }) }); setBusy(false); if (!r.ok) { setMsg(r.error.message); return; } toast({ tone: "success", title: "Appointment rescheduled" }); setResched(false); router.refresh(); }
  return (
    <div className="space-y-3">
      {msg && <Alert tone="danger">{msg}</Alert>}
      <div className="flex flex-wrap gap-2">
        {canReschedule && <Button variant="outline" onClick={() => setResched(true)}>Reschedule</Button>}
        {canCancel && <Button variant="danger" onClick={() => setCancel(true)}>Cancel appointment</Button>}
      </div>
      <ConfirmDialog open={cancel} onCancel={() => setCancel(false)} onConfirm={doCancel} loading={busy} title="Cancel this appointment?" description="The time will be released for other patients. You can book again any time." confirmLabel="Yes, cancel it" cancelLabel="Keep it" />
      {resched && (
        <Modal open onClose={() => setResched(false)} title="Choose a new time" footer={<><Button variant="outline" onClick={() => setResched(false)}>Close</Button><Button onClick={doResched} loading={busy} disabled={!slot}>Confirm new time</Button></>}>
          <div className="space-y-3">
            {!doctorHandle && <Alert tone="info">This doctor isn&apos;t open for online rescheduling. Please call the clinic.</Alert>}
            <Field label="New date"><TextInput type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} disabled={!doctorHandle} /></Field>
            {loading ? <LoadingState label="Checking the schedule…" /> : slots && (!slots.slots.length ? <Alert tone="info">{slots.message || "No times are free on this day."}</Alert> : <div role="radiogroup" aria-label={`Times on ${dayLabel(date)}`} className="grid grid-cols-3 gap-2">{slots.slots.map((s) => <button key={s.startsAt} type="button" role="radio" aria-checked={slot === s.startsAt} onClick={() => setSlot(s.startsAt)} className={`type-label min-h-12 rounded-lg border px-2 ${slot === s.startsAt ? "border-primary bg-primary text-on-brand" : "border-line-strong bg-surface"}`}>{s.label}</button>)}</div>)}
          </div>
        </Modal>
      )}
    </div>
  );
}
