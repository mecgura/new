"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, LayoutTemplate, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, ConfirmationDialog, EmptyState, Field, Input, LoadingState, Modal, PageHeader, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type Row = { id: string; title: string; slug: string; status: string; url: string; updatedAt: string; blockCount: number; views30: number; leads30: number; conversion30: number | null; unpublishedChanges: boolean };
type Starter = { id: string; name: string; description: string; title: string };

/** Landing pages list: create from an industry template, open the builder, duplicate, delete. */
export function PagesList({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const base = `/api/organizations/${orgId}/pages`;
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [starters, setStarters] = React.useState<Starter[]>([]);
  const [creating, setCreating] = React.useState(false);
  const [pick, setPick] = React.useState("blank");
  const [title, setTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [del, setDel] = React.useState<Row | null>(null);
  const [n, setN] = React.useState(0);

  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ pages: Row[]; starters: Starter[] }>(base);
      if (r.ok) {
        setRows(r.data.pages);
        setStarters(r.data.starters);
      } else toast(r.error, "error");
    }, 0);
    return () => clearTimeout(t);
  }, [base, n, toast]);

  async function create() {
    setBusy(true);
    const r = await apiFetch<{ page: { id: string } }>(base, { method: "POST", body: { title: title.trim() || starters.find((s) => s.id === pick)?.title || "New page", starter: pick } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    router.push(`/pages/${r.data.page.id}`);
  }
  async function duplicate(id: string) {
    const r = await apiFetch<{ page: { id: string } }>(`${base}/${id}/duplicate`, { method: "POST" });
    if (!r.ok) return toast(r.error, "error");
    toast("Copied. The copy is a draft.");
    setN((x) => x + 1);
  }
  async function remove() {
    if (!del) return;
    const r = await apiFetch(`${base}/${del.id}`, { method: "DELETE" });
    setDel(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Page deleted.");
    setN((x) => x + 1);
  }

  return (
    <>
      <PageHeader title="Landing pages" description="Simple pages for ads, QR codes and Instagram bio links. Every form entry lands in Contacts and alerts your team." actions={canManage ? <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" /> New page</Button> : null} />
      {!rows ? <LoadingState /> : !rows.length ? (
        <Card><EmptyState icon={LayoutTemplate} title="No pages yet" description="Start from a template for your industry: salon, clinic, real estate, coaching or restaurant." action={canManage ? <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden="true" /> New page</Button> : undefined} /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <Card key={p.id}>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/pages/${p.id}`} className="block truncate text-body font-semibold text-app-text hover:text-app-primary">{p.title}</Link>
                    <p className="truncate text-caption text-app-subtle">/{p.slug}</p>
                  </div>
                  <Badge tone={p.status === "published" ? "success" : "neutral"}>{p.status === "published" ? (p.unpublishedChanges ? "Live · changes" : "Live") : "Draft"}</Badge>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-[var(--radius-control)] bg-app-elevated p-2"><dt className="text-caption text-app-muted">Views</dt><dd className="text-body font-semibold text-app-text">{p.views30}</dd></div>
                  <div className="rounded-[var(--radius-control)] bg-app-elevated p-2"><dt className="text-caption text-app-muted">Leads</dt><dd className="text-body font-semibold text-app-text">{p.leads30}</dd></div>
                  <div className="rounded-[var(--radius-control)] bg-app-elevated p-2"><dt className="text-caption text-app-muted">Converts</dt><dd className="text-body font-semibold text-app-text">{p.conversion30 === null ? "—" : `${p.conversion30}%`}</dd></div>
                </dl>
                <p className="text-caption text-app-subtle">Last 30 days</p>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/pages/${p.id}`}><Button size="sm">{canManage ? "Edit" : "Open"}</Button></Link>
                  {p.status === "published" ? <a href={p.url} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="secondary"><ExternalLink className="size-4" aria-hidden="true" /> View</Button></a> : null}
                  {canManage ? <Button size="sm" variant="ghost" onClick={() => void duplicate(p.id)} aria-label={`Duplicate ${p.title}`}><Copy className="size-4" /></Button> : null}
                  {canManage ? <Button size="sm" variant="ghost" onClick={() => setDel(p)} aria-label={`Delete ${p.title}`}><Trash2 className="size-4" /></Button> : null}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      {creating ? (
        <Modal open onClose={() => setCreating(false)} size="lg" title="New landing page" description="Pick a starting point. Everything can be changed in the builder." footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={() => void create()} loading={busy}>Create and open builder</Button></>}>
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Template">
              {starters.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={pick === s.id} onClick={() => setPick(s.id)} className={cn("rounded-[var(--radius-control)] border p-3 text-left", pick === s.id ? "border-app-primary bg-app-primary-soft" : "border-app-border hover:bg-app-hover")}>
                  <span className="block text-small font-semibold text-app-text">{s.name}</span>
                  <span className="block text-caption text-app-muted">{s.description}</span>
                </button>
              ))}
            </div>
            <Field id="np-title" label="Page name" hint="Shown in the browser tab and used for the page address. You can change both later.">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={starters.find((s) => s.id === pick)?.title} />
            </Field>
          </div>
        </Modal>
      ) : null}
      <ConfirmationDialog open={Boolean(del)} onClose={() => setDel(null)} onConfirm={() => void remove()} title={`Delete “${del?.title ?? ""}”?`} description="The page goes offline and its stats are deleted. Contacts it created stay in your CRM." confirmLabel="Delete page" />
    </>
  );
}
