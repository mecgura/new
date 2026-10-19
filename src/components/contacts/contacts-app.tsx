"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Trash2, Upload, UserPlus, Users } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  SearchBar,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  buttonVariants,
  useToast,
} from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { stripVcfBinary } from "@/lib/vcf";
import type { InboxPerms } from "@/lib/inbox-context";
import { dayFmt, type Tag, type TeamMember } from "@/components/inbox/types";
import { LEAD_STATUSES } from "@/components/inbox/customer-panel";

type Contact = {
  id: string;
  name: string;
  phone: string;
  email: string;
  lifecycle: string;
  leadStatus: string;
  source: string;
  owner: { id: string; name: string } | null;
  optInStatus: string;
  suppressed: boolean;
  tags: Tag[];
  lastMessageAt: string | null;
  lastConversation: { id: string; lastMessagePreview: string } | null;
};

const TABS = [
  { id: "all", label: "All" },
  { id: "customers", label: "Customers" },
  { id: "leads", label: "Leads" },
  { id: "opted_in", label: "Opted In" },
  { id: "opted_out", label: "Opted Out" },
  { id: "suppressed", label: "Suppression" },
];

export const CONSENT: Record<string, { label: string; tone: "success" | "danger" | "neutral" }> = {
  opted_in: { label: "Opted in", tone: "success" },
  opted_out: { label: "Opted out", tone: "danger" },
  unknown: { label: "Unknown", tone: "neutral" },
};

export function ContactsApp({ orgId, perms }: { orgId: string; perms: InboxPerms }) {
  const [tab, setTab] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [tagId, setTagId] = React.useState("");
  const [leadStatus, setLeadStatus] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<{ items: Contact[]; total: number; pageSize: number; counts: Record<string, number> } | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [tags, setTags] = React.useState<Tag[]>([]);
  const [team, setTeam] = React.useState<TeamMember[]>([]);
  const [addOpen, setAddOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const toast = useToast();
  const qs = new URLSearchParams({ tab, q, tagId, leadStatus, page: String(page), pageSize: "25" }).toString();

  const load = React.useCallback(async () => {
    setLoading(true);
    const r = await apiFetch<{ items: Contact[]; total: number; pageSize: number; counts: Record<string, number> }>(`/api/organizations/${orgId}/contacts?${qs}`);
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [orgId, qs]);

  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);
  React.useEffect(() => {
    void apiFetch<{ tags: Tag[] }>(`/api/organizations/${orgId}/tags`).then((r) => r.ok && setTags(r.data.tags));
    void apiFetch<{ members: TeamMember[] }>(`/api/organizations/${orgId}/team`).then((r) => r.ok && setTeam(r.data.members));
  }, [orgId]);

  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    setPage(1);
    setSelected(new Set());
    setAllMatching(false);
    fn(v);
  };
  const pageIds = data?.items.map((c) => c.id) ?? [];
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selectedCount = allMatching ? (data?.total ?? 0) : selected.size;
  function togglePage() {
    setAllMatching(false);
    setSelected(pageAllSelected ? new Set() : new Set(pageIds));
  }
  function toggleOne(id: string) {
    setAllMatching(false);
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  async function bulkDelete() {
    setDeleting(true);
    const body = allMatching ? { filter: { tab, q, tagId, leadStatus }, expectedCount: data?.total ?? 0 } : { ids: [...selected] };
    const r = await apiFetch<{ deleted: number }>(`/api/organizations/${orgId}/contacts/bulk-delete`, { method: "POST", body });
    setDeleting(false);
    setConfirmDelete(false);
    if (!r.ok) return toast(r.error, "error");
    toast(`${r.data.deleted} contact${r.data.deleted === 1 ? "" : "s"} deleted`);
    setSelected(new Set());
    setAllMatching(false);
    setPage(1);
    void load();
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Customers and leads across your WhatsApp numbers."
        actions={
          <>
            {perms["contacts:import"] ? (
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload aria-hidden="true" /> Import CSV / VCF
              </Button>
            ) : null}
            {perms["contacts:export"] ? (
              <a href={`/api/organizations/${orgId}/contacts/export?${new URLSearchParams({ tab, q, tagId, leadStatus })}`} className={buttonVariants({ variant: "secondary" })}>
                <Download aria-hidden="true" /> Export CSV
              </a>
            ) : null}
            {perms["contacts:write"] ? (
              <Button onClick={() => setAddOpen(true)}>
                <UserPlus aria-hidden="true" /> Add Contact
              </Button>
            ) : null}
          </>
        }
      />
      <Card>
        <Tabs label="Contact segments" items={TABS.map((t) => ({ id: t.id, label: `${t.label} ${data?.counts[t.id] ?? ""}`.trim() }))} value={tab} onValueChange={resetPage(setTab)} className="px-2" />
        <FilterBar>
          <SearchBar label="Search contacts" placeholder="Search name, phone or email…" value={q} onChange={(e) => resetPage(setQ)(e.target.value)} className="sm:w-72" />
          <Select aria-label="Filter by tag" value={tagId} onChange={(e) => resetPage(setTagId)(e.target.value)} className="sm:w-44">
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          <Select aria-label="Filter by lead status" value={leadStatus} onChange={(e) => resetPage(setLeadStatus)(e.target.value)} className="capitalize sm:w-44">
            <option value="">All lead statuses</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </FilterBar>
        {error ? (
          <ErrorState description={error} onRetry={load} />
        ) : !data ? (
          <LoadingState />
        ) : data.items.length === 0 ? (
          <EmptyState icon={Users} title={q || tagId || leadStatus ? "No contacts match" : "No contacts here yet"} description="Contacts are created automatically when customers message you, or add / import them." />
        ) : (
          <>
            {perms["contacts:delete"] && selectedCount > 0 ? (
              <div className="flex flex-wrap items-center gap-3 border-b border-app-border bg-app-primary-soft px-4 py-2.5 text-small">
                <span className="font-medium text-app-text">{selectedCount} selected</span>
                {!allMatching && pageAllSelected && data.total > pageIds.length ? (
                  <button type="button" className="text-app-primary underline" onClick={() => setAllMatching(true)}>
                    Select all {data.total} contacts in this list
                  </button>
                ) : null}
                <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden="true" /> Delete
                </Button>
                <button type="button" className="text-app-muted underline" onClick={() => { setSelected(new Set()); setAllMatching(false); }}>
                  Clear
                </button>
              </div>
            ) : null}
            <Table caption="Contacts" aria-busy={loading} className="min-w-[1000px]">
              <THead>
                <tr>
                  {perms["contacts:delete"] ? (
                    <TH className="w-10">
                      <input type="checkbox" aria-label="Select all contacts on this page" checked={pageAllSelected} onChange={togglePage} className="size-4 accent-emerald-600" />
                    </TH>
                  ) : null}
                  <TH>Name</TH>
                  <TH>Phone</TH>
                  <TH>Tags</TH>
                  <TH>Lead status</TH>
                  <TH>Source</TH>
                  <TH>Agent</TH>
                  <TH>Consent</TH>
                  <TH>Last conversation</TH>
                </tr>
              </THead>
              <TBody>
                {data.items.map((c) => (
                  <TR key={c.id}>
                    {perms["contacts:delete"] ? (
                      <TD>
                        <input type="checkbox" aria-label={`Select ${c.name || c.phone}`} checked={allMatching || selected.has(c.id)} onChange={() => toggleOne(c.id)} className="size-4 accent-emerald-600" />
                      </TD>
                    ) : null}
                    <TD>
                      <Link href={`/contacts/${c.id}`} className="font-medium hover:text-app-primary-hover">
                        {c.name || "Unnamed"}
                      </Link>
                      <p className="text-caption text-app-subtle">{c.email || (c.lifecycle === "customer" ? "Customer" : "Lead")}</p>
                    </TD>
                    <TD className="font-mono text-small">{c.phone}</TD>
                    <TD>
                      <div className="flex max-w-[12rem] flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => <Badge key={t.id} tone="primary">{t.name}</Badge>)}
                        {c.tags.length > 3 ? <Badge>+{c.tags.length - 3}</Badge> : null}
                      </div>
                    </TD>
                    <TD className="capitalize">{c.leadStatus}</TD>
                    <TD className="capitalize text-app-muted">{c.source}</TD>
                    <TD>{c.owner?.name ?? <span className="text-app-subtle">—</span>}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={CONSENT[c.optInStatus]?.tone ?? "neutral"} dot>{CONSENT[c.optInStatus]?.label ?? c.optInStatus}</Badge>
                        {c.suppressed ? <Badge tone="danger">Suppressed</Badge> : null}
                      </div>
                    </TD>
                    <TD className="max-w-[14rem]">
                      {c.lastConversation ? (
                        <Link href={`/inbox?c=${c.lastConversation.id}`} className="block truncate text-small hover:text-app-primary-hover">
                          {c.lastConversation.lastMessagePreview || "Open chat"}
                          {c.lastMessageAt ? <span className="block text-caption text-app-subtle">{dayFmt.format(new Date(c.lastMessageAt))}</span> : null}
                        </Link>
                      ) : (
                        <span className="text-app-subtle">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </>
        )}
      </Card>
      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} orgId={orgId} team={team} onCreated={() => { setAddOpen(false); void load(); }} />
      <ConfirmationDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={bulkDelete}
        loading={deleting}
        title={`Delete ${selectedCount} contact${selectedCount === 1 ? "" : "s"}?`}
        description="The contacts, their conversations, notes and consent history are permanently deleted. This cannot be undone."
        confirmLabel="Delete permanently"
      />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} orgId={orgId} onDone={load} />
    </>
  );
}

function AddContactModal({ open, onClose, orgId, team, onCreated }: { open: boolean; onClose: () => void; orgId: string; team: TeamMember[]; onCreated: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const empty = { name: "", phone: "", email: "", lifecycle: "lead", leadStatus: "new", ownerUserId: "", tags: "", optIn: false, evidence: "" };
  const [f, setF] = React.useState(empty);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await apiFetch<{ contact: { id: string } }>(`/api/organizations/${orgId}/contacts`, {
      method: "POST",
      body: {
        name: f.name,
        phone: f.phone,
        email: f.email,
        lifecycle: f.lifecycle,
        leadStatus: f.leadStatus,
        ownerUserId: f.ownerUserId || null,
        tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
        ...(f.optIn ? { optInStatus: "opted_in", consentEvidence: f.evidence } : {}),
      },
    });
    setSaving(false);
    if (!r.ok) return setErrors({ ...Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""])), form: r.details ? "" : r.error });
    setErrors({});
    setF(empty);
    toast("Contact added");
    onCreated();
    router.push(`/contacts/${r.data.contact.id}`);
  }
  return (
    <Modal open={open} onClose={onClose} title="Add contact" size="lg">
      <form onSubmit={submit} noValidate className="space-y-4">
        {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ac-name" label="Name" error={errors.name}><Input value={f.name} onChange={set("name")} /></Field>
          <Field id="ac-phone" label="WhatsApp phone" hint="10-digit Indian numbers get +91" error={errors.phone}><Input type="tel" value={f.phone} onChange={set("phone")} placeholder="+91 98765 43210" /></Field>
          <Field id="ac-email" label="Email" error={errors.email}><Input type="email" value={f.email} onChange={set("email")} /></Field>
          <Field id="ac-tags" label="Tags" hint="Comma separated"><Input value={f.tags} onChange={set("tags")} placeholder="VIP, Delhi" /></Field>
          <Field id="ac-life" label="Type">
            <Select value={f.lifecycle} onChange={set("lifecycle")}><option value="lead">Lead</option><option value="customer">Customer</option></Select>
          </Field>
          <Field id="ac-status" label="Lead status">
            <Select value={f.leadStatus} onChange={set("leadStatus")} className="capitalize">{LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
          </Field>
          <Field id="ac-owner" label="Assigned agent" error={errors.ownerUserId}>
            <Select value={f.ownerUserId} onChange={set("ownerUserId")}>
              <option value="">Unassigned</option>
              {team.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
            </Select>
          </Field>
        </div>
        <Checkbox label="This person has opted in to WhatsApp messages" description="Record how consent was collected below." checked={f.optIn} onChange={(e) => setF((x) => ({ ...x, optIn: e.target.checked }))} />
        {f.optIn ? <Field id="ac-evidence" label="Consent evidence"><Input value={f.evidence} onChange={set("evidence")} placeholder="e.g. Website form on 6 Oct" /></Field> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving} disabled={!f.phone}>Add contact</Button>
        </div>
      </form>
    </Modal>
  );
}

function ImportModal({ open, onClose, orgId, onDone }: { open: boolean; onClose: () => void; orgId: string; onDone: () => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const [result, setResult] = React.useState<{ created: number; updated: number; skipped: number; errors: { line: number; error: string }[] } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSaving(true);
    setError("");
    const fd = new FormData();
    let upload: File = file;
    if (/\.(vcf|vcard)$/i.test(file.name)) {
      // Drop embedded photos in the browser so big phone exports fit the upload limit.
      upload = new File([stripVcfBinary(await file.text())], file.name, { type: "text/vcard" });
    }
    if (upload.size > 2 * 1024 * 1024) {
      setSaving(false);
      return setError(`This file is still ${(upload.size / 1048576).toFixed(1)} MB after removing photos. Split it into smaller files (the limit is 2 MB and 5,000 contacts).`);
    }
    fd.set("file", upload);
    try {
      const res = await fetch(`/api/organizations/${orgId}/contacts/import`, { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { error?: string; created: number; updated: number; skipped: number; errors: { line: number; error: string }[] };
      if (!res.ok) return setError(res.status === 413 ? "The file is too large. Split it into smaller files." : (data.error ?? "Import failed"));
      setResult(data);
      onDone();
    } catch {
      setError("Network error — nothing was imported.");
    } finally {
      setSaving(false);
    }
  }
  function close() {
    setFile(null);
    setResult(null);
    setError("");
    onClose();
  }
  return (
    <Modal open={open} onClose={close} title="Import contacts from CSV or VCF" description="A phone contacts file (.vcf) works too: names, numbers and emails are read from it. CSV columns: name, phone (required), email, tags (separate with ;), lead_status, lifecycle, source, opt_in (yes/no). Existing phone numbers are updated.">
      {result ? (
        <div className="space-y-3">
          <Alert tone="success" title="Import finished">
            {result.created} created · {result.updated} updated · {result.skipped} skipped
          </Alert>
          {result.errors.length ? (
            <ul className="max-h-48 space-y-1 overflow-y-auto text-small text-app-muted">
              {result.errors.map((er) => <li key={er.line}>Line {er.line}: {er.error}</li>)}
            </ul>
          ) : null}
          <div className="flex justify-end"><Button onClick={close}>Done</Button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field id="csv-file" label="CSV or VCF file (max 2 MB after photos are removed, 5,000 contacts)">
            <Input type="file" accept=".csv,.vcf,text/csv,text/vcard,text/x-vcard" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-1.5" />
          </Field>
          <p className="text-caption text-app-subtle">Only import people who agreed to hear from you on WhatsApp. Mark consent with the opt_in column.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!file}>Import</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
