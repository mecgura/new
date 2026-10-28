"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, LoadingState, Select, Table, TBody, TD, TH, THead, TR, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatINR, formatNumber } from "@/lib/catalog";
import { PackageMeters, type PackageView } from "@/components/billing/package-panel";

/** Client page → Wallet: package usage this month and manual top-up credits. Hidden unless the client is on a package. */
export function AdminPackageCard({ organizationId, refreshKey = 0 }: { organizationId: string; refreshKey?: number }) {
  const toast = useToast();
  const url = `/api/admin/organizations/${organizationId}/package`;
  const [pkg, setPkg] = React.useState<PackageView | null>(null);
  const [f, setF] = React.useState({ marketing: "", utility: "", note: "" });
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    void apiFetch<{ package: PackageView }>(url).then((r) => r.ok && setPkg(r.data.package));
  }, [url, refreshKey]);

  async function grant() {
    setBusy(true);
    const r = await apiFetch<{ package: PackageView }>(url, { method: "POST", body: { marketing: Number(f.marketing || 0), utility: Number(f.utility || 0), note: f.note } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setPkg(r.data.package);
    setF({ marketing: "", utility: "", note: "" });
    toast("Credits updated");
  }

  if (!pkg?.active) return null;
  return (
    <Card>
      <CardHeader title={`Message package${pkg.planName ? ` · ${pkg.planName}` : ""}`} description={`Included messages come from the plan (Billing & Plans). Resets ${pkg.resetsOn}.`} />
      <CardBody className="space-y-4">
        {pkg.marketing.included === 0 && pkg.utility.included === 0 ? (
          <Alert tone="warning">This client&apos;s plan includes no messages yet. Set &quot;Included marketing / utility messages&quot; on the plan in <Link className="underline" href="/admin/billing">Billing &amp; Plans</Link>.</Alert>
        ) : null}
        <PackageMeters pkg={pkg} />
        <div className="flex flex-wrap items-end gap-3">
          <Field id="pk-m" label="Add marketing credits"><Input inputMode="numeric" value={f.marketing} onChange={(e) => setF({ ...f, marketing: e.target.value.replace(/[^\d-]/g, "") })} placeholder="1000" className="w-32" /></Field>
          <Field id="pk-u" label="Add utility credits"><Input inputMode="numeric" value={f.utility} onChange={(e) => setF({ ...f, utility: e.target.value.replace(/[^\d-]/g, "") })} placeholder="0" className="w-32" /></Field>
          <Field id="pk-n" label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Paid by UPI" className="w-48" /></Field>
          <Button loading={busy} disabled={!f.marketing && !f.utility} onClick={() => void grant()}>Save</Button>
        </div>
        <p className="text-caption text-app-subtle">Use a negative number to take credits back.</p>
      </CardBody>
    </Card>
  );
}

type Pack = { id: string; bucket: "marketing" | "utility"; quantity: number; priceRupees: number };
type Bucket = { included: number; used: number; credits: number; remaining: number; unlimited: boolean };
type ClientRow = { organizationId: string; name: string; planName: string; price: number; metaCost: number; margin: number; marketing: Bucket; utility: Bucket };

/** Admin → Billing & Plans → Message packages: top-up packs for sale and this month's margin per package client. */
export function PackagesAdminTab() {
  const toast = useToast();
  const [data, setData] = React.useState<{ packs: Pack[]; clients: ClientRow[] } | null>(null);
  const [packs, setPacks] = React.useState<Pack[]>([]);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    void apiFetch<{ packs: Pack[]; clients: ClientRow[] }>("/api/admin/package").then((r) => {
      if (!r.ok) return toast(r.error, "error");
      setData(r.data);
      setPacks(r.data.packs);
    });
  }, [toast]);

  async function save() {
    setBusy(true);
    const r = await apiFetch<{ packs: Pack[] }>("/api/admin/package", { method: "PUT", body: { packs } });
    setBusy(false);
    if (!r.ok) return toast(Object.values(r.details ?? {}).flat()[0] ?? r.error, "error");
    toast("Top-up packs saved");
  }
  const patch = (i: number, p: Partial<Pack>) => setPacks((xs) => xs.map((x, j) => (j === i ? { ...x, ...p } : x)));

  if (!data) return <LoadingState />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="This month: package clients" description="Estimated Meta cost (messages used × Meta rates in Meta balance) against the plan price. Lowest margin first." />
        {data.clients.length ? (
          <Table>
            <THead><TR><TH>Client</TH><TH>Plan</TH><TH>Marketing used</TH><TH>Utility used</TH><TH>Meta cost (est.)</TH><TH>Plan price</TH><TH>Margin</TH></TR></THead>
            <TBody>
              {data.clients.map((c) => (
                <TR key={c.organizationId}>
                  <TD><Link className="font-medium text-app-primary hover:underline" href={`/admin/clients/${c.organizationId}?tab=wallet`}>{c.name}</Link></TD>
                  <TD>{c.planName || "—"}</TD>
                  <TD>{formatNumber(c.marketing.used)}{c.marketing.unlimited ? "" : ` / ${formatNumber(c.marketing.included)}`}</TD>
                  <TD>{formatNumber(c.utility.used)}{c.utility.unlimited ? "" : ` / ${formatNumber(c.utility.included)}`}</TD>
                  <TD>{formatINR(c.metaCost)}</TD>
                  <TD>{formatINR(c.price)}</TD>
                  <TD><Badge tone={c.margin < 0 ? "danger" : c.margin < c.price * 0.3 ? "warning" : "success"}>{formatINR(c.margin)}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <CardBody><p className="text-small text-app-muted">No client is on the &quot;Message package&quot; billing type yet. Set it on a client&apos;s Wallet tab.</p></CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Top-up packs" description="What package clients can buy from their wallet when the monthly allowance runs out. Top-ups never expire." />
        <CardBody className="space-y-3">
          {packs.map((p, i) => (
            <div key={i} className="flex flex-wrap items-end gap-3">
              <Field id={`pp-b-${i}`} label="Type"><Select value={p.bucket} onChange={(e) => patch(i, { bucket: e.target.value as Pack["bucket"] })} className="w-36"><option value="marketing">Marketing</option><option value="utility">Utility</option></Select></Field>
              <Field id={`pp-q-${i}`} label="Messages"><Input inputMode="numeric" value={String(p.quantity)} onChange={(e) => patch(i, { quantity: Number(e.target.value.replace(/\D/g, "")) || 0 })} className="w-32" /></Field>
              <Field id={`pp-p-${i}`} label="Price (₹)"><Input inputMode="decimal" value={String(p.priceRupees)} onChange={(e) => patch(i, { priceRupees: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} className="w-32" /></Field>
              <p className="pb-2 text-caption text-app-subtle">{p.quantity ? `₹${(p.priceRupees / p.quantity).toFixed(2)} per message` : ""}</p>
              <Button variant="ghost" aria-label="Remove pack" onClick={() => setPacks((xs) => xs.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={packs.length >= 12} onClick={() => setPacks((xs) => [...xs, { id: `pack-${Date.now().toString(36)}`, bucket: "marketing", quantity: 1000, priceRupees: 1200 }])}><Plus /> Add pack</Button>
            <Button loading={busy} onClick={() => void save()}>Save packs</Button>
          </div>
          <p className="text-caption text-app-subtle">Tip: keep marketing packs above Meta&apos;s marketing rate (about ₹0.78 + GST per message) so every top-up makes money.</p>
        </CardBody>
      </Card>
    </div>
  );
}
