"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, LoadingState, Modal, Select, SearchInput, StatusBadge, TextInput, Textarea, Toggle, useToast } from "@/components/ui";
import { apiFetch } from "@/lib/api/client";
import { bpToInput, formatMoney, minorToInput, moneyToMinor, percentToBp } from "@/lib/billing/money";
import type { ServiceView } from "@/lib/services/billing-master";
import { SERVICE_TYPE_LABEL } from "./billing-ui";

interface Tax { id: string; name: string; rateBp: number; type: string; active: boolean }
export function ServiceMaster({ canConfigure, currency }: { canConfigure: boolean; currency: string }) {
  const toast = useToast();
  const [services, setServices] = useState<ServiceView[] | null>(null); const [taxes, setTaxes] = useState<Tax[]>([]); const [q, setQ] = useState(""); const [err, setErr] = useState<string>();
  const [edit, setEdit] = useState<ServiceView | "new" | null>(null); const [taxOpen, setTaxOpen] = useState(false);
  const load = useCallback(async () => {
    const [s, t] = await Promise.all([apiFetch<{ services: ServiceView[] }>(`/api/billing/services?all=1&q=${encodeURIComponent(q)}`), apiFetch<{ taxes: Tax[] }>("/api/billing/taxes")]);
    if (s.ok) { setServices(s.data.services); setErr(undefined); } else setErr(s.error.message);
    if (t.ok) setTaxes(t.data.taxes);
  }, [q]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  if (err && !services) return <ErrorState description={err} action={<Button onClick={load}>Try again</Button>} />;
  return (
    <div className="space-y-section">
      {!canConfigure && <Alert tone="info">You can see the price list. Only a clinic admin can change it.</Alert>}
      <Card><CardHeader title="Services & prices" description="Prices are never hard-coded. Changing a price affects new invoices only." action={canConfigure ? <Button size="sm" onClick={() => setEdit("new")}><Plus aria-hidden className="size-4" />Add service</Button> : undefined} />
        <CardBody className="space-y-3"><SearchInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or code" aria-label="Search services" />
          {!services ? <LoadingState /> : !services.length ? <EmptyState title="No services yet" description={canConfigure ? "Add consultation, follow-up, procedure and investigation prices." : "None configured yet."} /> : (
            <ul className="divide-y divide-line">{services.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0"><p className="type-label"><span className="tabular-nums">{s.serviceCode}</span> · {s.serviceName}</p><p className="type-caption">{SERVICE_TYPE_LABEL[s.type]}{s.category ? ` · ${s.category}` : ""}{s.taxName ? ` · ${s.taxName} ${bpToInput(s.taxRateBp)}%` : " · no tax"}{s.discountEligible ? "" : " · no discount"}</p></div>
                <div className="flex items-center gap-2"><span className="type-label tabular-nums">{formatMoney(s.priceMinor, currency)}</span>{!s.active && <Badge>Inactive</Badge>}{canConfigure && <Button size="sm" variant="outline" onClick={() => setEdit(s)}>Edit</Button>}</div>
              </li>))}</ul>)}</CardBody></Card>
      <Card><CardHeader title="Taxes" description="Rates you add here can be attached to services. Old invoices keep the tax they were issued with." action={canConfigure ? <Button size="sm" onClick={() => setTaxOpen(true)}><Plus aria-hidden className="size-4" />Add tax</Button> : undefined} />
        {!taxes.length ? <EmptyState title="No taxes configured" /> : <ul className="divide-y divide-line">{taxes.map((t) => <li key={t.id} className="flex items-center justify-between gap-2 p-card"><span className="type-label">{t.name} <span className="type-caption">{t.type} · {bpToInput(t.rateBp)}%</span></span><span className="flex items-center gap-2"><StatusBadge tone={t.active ? "success" : "neutral"}>{t.active ? "Active" : "Inactive"}</StatusBadge>{canConfigure && <Button size="sm" variant="outline" onClick={async () => { const r = await apiFetch(`/api/billing/taxes/${t.id}`, { method: "PATCH", body: JSON.stringify({ active: !t.active }) }); if (r.ok) await load(); else toast({ tone: "danger", title: r.error.message }); }}>{t.active ? "Disable" : "Enable"}</Button>}</span></li>)}</ul>}
      </Card>
      {edit && <ServiceModal service={edit === "new" ? null : edit} taxes={taxes.filter((t) => t.active)} currency={currency} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await load(); }} />}
      {taxOpen && <TaxModal onClose={() => setTaxOpen(false)} onSaved={async () => { setTaxOpen(false); await load(); }} />}
    </div>
  );
}
function TaxModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ name: "", rate: "", type: "GST" }); const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  async function save() {
    const bp = percentToBp(f.rate); if (bp == null) { setErrors({ rateBp: "Enter a rate like 18 or 2.5." }); return; }
    setBusy(true); setErrors({}); const r = await apiFetch("/api/billing/taxes", { method: "POST", body: JSON.stringify({ name: f.name, rateBp: bp, type: f.type }) }); setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? { name: r.error.message }); return; } await onSaved();
  }
  return <Modal open onClose={onClose} title="Add tax" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}><div className="space-y-3"><Field label="Name" required error={errors.name}><TextInput value={f.name} maxLength={40} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Rate (%)" required error={errors.rateBp}><TextInput value={f.rate} inputMode="decimal" onChange={(e) => setF({ ...f, rate: e.target.value })} /></Field><Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={["GST", "VAT", "SALES", "OTHER"].map((v) => ({ value: v, label: v }))} /></Field></div></div></Modal>;
}
function ServiceModal({ service, taxes, currency, onClose, onSaved }: { service: ServiceView | null; taxes: Tax[]; currency: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ serviceCode: service?.serviceCode ?? "", serviceName: service?.serviceName ?? "", type: service?.type ?? "CONSULTATION", category: service?.category ?? "", description: service?.description ?? "", price: service ? minorToInput(service.priceMinor) : "", taxId: service?.taxId ?? "", discountEligible: service?.discountEligible ?? true, active: service?.active ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  async function save() {
    const price = moneyToMinor(f.price); if (price == null) { setErrors({ priceMinor: "Enter a price like 500 or 499.50." }); return; }
    setBusy(true); setErrors({});
    const r = await apiFetch(service ? `/api/billing/services/${service.id}` : "/api/billing/services", { method: service ? "PUT" : "POST", body: JSON.stringify({ serviceCode: f.serviceCode, serviceName: f.serviceName, type: f.type, category: f.category || undefined, description: f.description || undefined, priceMinor: price, taxId: f.taxId || undefined, discountEligible: f.discountEligible, active: f.active, investigationId: service?.investigationId ?? undefined }) });
    setBusy(false);
    if (!r.ok) { setErrors(r.error.fieldErrors ?? { serviceName: r.error.message }); return; } await onSaved();
  }
  return (
    <Modal open onClose={onClose} title={service ? `Edit ${service.serviceCode}` : "Add service"} description="Old invoices keep the price and name they were issued with." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save service</Button></>}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Service code" required error={errors.serviceCode}><TextInput value={f.serviceCode} maxLength={20} onChange={(e) => setF({ ...f, serviceCode: e.target.value })} /></Field><Field label="Type" required error={errors.type}><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={Object.entries(SERVICE_TYPE_LABEL).map(([value, label]) => ({ value, label }))} /></Field></div>
        <Field label="Service name" required error={errors.serviceName}><TextInput value={f.serviceName} maxLength={120} onChange={(e) => setF({ ...f, serviceName: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label={`Price (${currency})`} required error={errors.priceMinor}><TextInput value={f.price} inputMode="decimal" onChange={(e) => setF({ ...f, price: e.target.value })} /></Field><Field label="Tax" error={errors.taxId}><Select value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} placeholder="No tax" options={taxes.map((t) => ({ value: t.id, label: `${t.name} (${bpToInput(t.rateBp)}%)` }))} /></Field></div>
        <Field label="Category" error={errors.category}><TextInput value={f.category} maxLength={60} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="Description" error={errors.description}><Textarea rows={2} value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Toggle label="Discounts allowed on this service" checked={f.discountEligible} onChange={(v) => setF({ ...f, discountEligible: v })} /><Toggle label="Available for billing" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
      </div>
    </Modal>
  );
}
