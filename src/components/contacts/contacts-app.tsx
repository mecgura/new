"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Upload, UserPlus, Users } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
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
    fn(v);
  };

  return (
    <>
      <PageHeader
        title="Contacts"
        description="Customers and leads across your WhatsApp numbers."
        actions={
          <>
            {perms["contacts:import"] ? (
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <Upload aria-hidden="true" /> Import CSV
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
            <Table caption="Contacts" aria-busy={loading} className="min-w-[1000px]">
              <THead>
                <tr>
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
    fd.set("file", file);
    try {
      const res = await fetch(`/api/organizations/${orgId}/contacts/import`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? "Import failed");
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
    <Modal open={open} onClose={close} title="Import contacts from CSV" description="Columns: name, phone (required), email, tags (separate with ;), lead_status, lifecycle, source, opt_in (yes/no). Existing phone numbers are updated.">
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
          <Field id="csv-file" label="CSV file (max 2 MB, 5,000 rows)">
            <Input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-1.5" />
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
