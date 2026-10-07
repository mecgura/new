"use client";

import { limitLabel } from "@/lib/plans";
import * as React from "react";
import { Activity, Phone, Plus, ScrollText, Trash2, UserPlus, UserX } from "lucide-react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  ConfirmationDialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingState,
  Modal,
  Pagination,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  UsageMeter,
  useToast,
} from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { ORG_ROLES, ORG_ROLE_LABELS, isOrgRole, type OrgRole } from "@/lib/authz";
import { SERVICES, WHATSAPP_STATUS_LABELS, formatINR, type ServiceKey } from "@/lib/catalog";
import { describeAction } from "@/lib/audit-actions";
import { AddMemberModal } from "@/components/app/settings/team-manager";

export type ClientDetail = {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: "active" | "suspended";
    contactEmail: string;
    contactPhone: string;
    createdAt: string;
    settings: { timezone: string; locale: string; currency: string } | null;
    services: { service: string; enabled: boolean }[];
    whatsappAccounts: { id: string; displayName: string; phoneNumber: string; status: string; createdAt: string }[];
    subscriptions: { id: string; status: string; priceMonthly: number; startedAt: string; endedAt: string | null; plan: { id: string; name: string; slug: string } }[];
    members: { id: string; role: string; createdAt: string; user: { id: string; name: string | null; email: string; status: string; lastLoginAt: string | null } }[];
  };
  plan: { id: string; name: string; priceMonthly: number; maxUsers: number; maxWhatsAppNumbers: number; maxMonthlyMessages: number; maxContacts: number } | null;
  usage: { key: string; label: string; used: number; limit: number | null }[];
};

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4">
      <dt className="w-40 shrink-0 text-small text-app-muted">{label}</dt>
      <dd className="min-w-0 break-words text-body text-app-text">{children}</dd>
    </div>
  );
}

export function OverviewTab({ d }: { d: ClientDetail }) {
  const o = d.organization;
  const owner = o.members.find((m) => m.role === "CLIENT_OWNER");
  const enabled = o.services.filter((s) => s.enabled).map((s) => SERVICES.find((x) => x.key === s.service)?.label ?? s.service);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Company" />
        <CardBody>
          <dl className="divide-y divide-app-border">
            <Row label="Company">{o.name}</Row>
            <Row label="Workspace ID">{o.slug}</Row>
            <Row label="Status">
              <Badge tone={o.status === "active" ? "success" : "danger"} dot>
                {o.status === "active" ? "Active" : "Suspended"}
              </Badge>
            </Row>
            <Row label="Contact email">{o.contactEmail || "—"}</Row>
            <Row label="Mobile">{o.contactPhone || "—"}</Row>
            <Row label="Created">{dateFmt.format(new Date(o.createdAt))}</Row>
            <Row label="Timezone">{o.settings ? `${o.settings.timezone} · ${o.settings.currency}` : "—"}</Row>
          </dl>
        </CardBody>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Owner" />
          <CardBody>
            {owner ? (
              <div className="flex items-center gap-3">
                <Avatar name={owner.user.name ?? owner.user.email} />
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-app-text">{owner.user.name ?? "—"}</p>
                  <p className="truncate text-small text-app-muted">{owner.user.email}</p>
                  <p className="text-caption text-app-subtle">Last sign-in: {owner.user.lastLoginAt ? dateTimeFmt.format(new Date(owner.user.lastLoginAt)) : "Never"}</p>
                </div>
              </div>
            ) : (
              <Alert tone="warning">This client has no owner. Add one from the Users tab.</Alert>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Plan & services" />
          <CardBody className="space-y-3">
            <p className="text-body text-app-text">{d.plan ? `${d.plan.name} · ${formatINR(d.plan.priceMonthly)}/month` : "No plan assigned"}</p>
            <div className="flex flex-wrap gap-1.5">
              {enabled.length ? enabled.map((s) => <Badge key={s} tone="primary">{s}</Badge>) : <span className="text-small text-app-muted">No services enabled</span>}
            </div>
            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              {d.usage.slice(0, 2).map((u) => (
                <UsageMeter key={u.key} label={u.label} used={u.used} limit={u.limit} />
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export function UsersTab({ d, onChanged, onReset }: { d: ClientDetail; onChanged: () => void; onReset: () => void }) {
  const toast = useToast();
  const o = d.organization;
  const [addOpen, setAddOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = React.useState<ClientDetail["organization"]["members"][number] | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ClientDetail["organization"]["members"][number] | null>(null);

  async function changeRole(memberId: string, role: OrgRole) {
    setBusy(memberId);
    const r = await apiFetch(`/api/organizations/${o.id}/members/${memberId}`, { method: "PATCH", body: { role } });
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Role updated");
    onChanged();
  }
  async function removeMembership() {
    if (!removeTarget) return;
    setBusy(removeTarget.id);
    const r = await apiFetch(`/api/organizations/${o.id}/members/${removeTarget.id}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    toast("Removed from client");
    setRemoveTarget(null);
    onChanged();
  }
  async function deleteUser() {
    if (!deleteTarget) return;
    setBusy(deleteTarget.id);
    const r = await apiFetch(`/api/admin/users/${deleteTarget.user.id}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    toast("User account deleted");
    setDeleteTarget(null);
    onChanged();
  }

  return (
    <Card>
      <CardHeader
        title="Users"
        description={`${o.members.length} of ${d.plan ? limitLabel(d.plan.maxUsers) : "—"} seats used`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onReset}>
              Reset access
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus aria-hidden="true" /> Add user
            </Button>
          </div>
        }
      />
      {o.members.length === 0 ? (
        <EmptyState icon={UserX} title="No users" />
      ) : (
        <Table caption="Client users">
          <THead>
            <tr>
              <TH>User</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Last sign-in</TH>
              <TH className="text-right">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {o.members.map((m) => (
              <TR key={m.id}>
                <TD>
                  <div className="flex items-center gap-3">
                    <Avatar name={m.user.name ?? m.user.email} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.user.name ?? "—"}</p>
                      <p className="truncate text-caption text-app-muted">{m.user.email}</p>
                    </div>
                  </div>
                </TD>
                <TD>
                  <Select aria-label={`Role for ${m.user.email}`} value={m.role} disabled={busy === m.id} onChange={(e) => changeRole(m.id, e.target.value as OrgRole)} className="h-9 w-36">
                    {ORG_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ORG_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                </TD>
                <TD>
                  <Badge tone={m.user.status === "active" ? "success" : "danger"} dot>
                    {m.user.status === "active" ? "Active" : "Disabled"}
                  </Badge>
                </TD>
                <TD className="text-app-muted">{m.user.lastLoginAt ? dateTimeFmt.format(new Date(m.user.lastLoginAt)) : "Never"}</TD>
                <TD className="whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" onClick={() => setRemoveTarget(m)} disabled={busy === m.id}>
                    Remove
                  </Button>
                  <IconButton label={`Delete account ${m.user.email}`} size="sm" onClick={() => setDeleteTarget(m)} disabled={busy === m.id}>
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <AddMemberModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        organizationId={o.id}
        onAdded={() => {
          setAddOpen(false);
          toast("User added");
          onChanged();
        }}
      />
      <ConfirmationDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={removeMembership}
        loading={busy === removeTarget?.id}
        title="Remove from client?"
        description={`${removeTarget?.user.email ?? ""} loses access to ${o.name}. Their login is kept.`}
        confirmLabel="Remove"
      />
      <ConfirmationDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteUser}
        loading={busy === deleteTarget?.id}
        title="Delete user account?"
        description={`${deleteTarget?.user.email ?? ""} is permanently deleted from the platform, including any other workspaces. This cannot be undone.`}
        confirmLabel="Delete account"
      />
    </Card>
  );
}

export function ServicesTab({ d, onChanged }: { d: ClientDetail; onChanged: () => void }) {
  const toast = useToast();
  const initial = React.useMemo(
    () => Object.fromEntries(SERVICES.map((s) => [s.key, d.organization.services.find((x) => x.service === s.key)?.enabled ?? false])) as Record<ServiceKey, boolean>,
    [d.organization.services]
  );
  const [state, setState] = React.useState(initial);
  const [saving, setSaving] = React.useState(false);
  const [lastInitial, setLastInitial] = React.useState(initial);
  if (lastInitial !== initial) {
    setLastInitial(initial);
    setState(initial);
  }
  const dirty = SERVICES.some((s) => state[s.key] !== initial[s.key]);

  async function save() {
    setSaving(true);
    const r = await apiFetch(`/api/admin/organizations/${d.organization.id}/services`, { method: "PUT", body: { services: state } });
    setSaving(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Services updated");
    onChanged();
  }

  return (
    <Card>
      <CardHeader title="Services" description="Modules enabled for this client. Each change is audit-logged." />
      <CardBody>
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="sr-only">Enabled services</legend>
          {SERVICES.map((s) => (
            <div key={s.key} className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-app-border p-3">
              <Checkbox label={s.label} description={s.description} checked={state[s.key]} onChange={(e) => setState((x) => ({ ...x, [s.key]: e.target.checked }))} />
              <Badge tone={initial[s.key] ? "success" : "neutral"}>{initial[s.key] ? "Enabled" : "Off"}</Badge>
            </div>
          ))}
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" disabled={!dirty || saving} onClick={() => setState(initial)}>
            Discard
          </Button>
          <Button loading={saving} disabled={!dirty} onClick={save}>
            Save services
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function WhatsAppTab({ d, onChanged }: { d: ClientDetail; onChanged: () => void }) {
  const toast = useToast();
  const o = d.organization;
  const [addOpen, setAddOpen] = React.useState(false);
  const [form, setForm] = React.useState({ displayName: "", phoneNumber: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<{ id: string; phoneNumber: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await apiFetch(`/api/admin/organizations/${o.id}/whatsapp-accounts`, { method: "POST", body: form });
    setSaving(false);
    if (!r.ok) {
      const det = Object.fromEntries(Object.entries(r.details ?? {}).map(([k, v]) => [k, v?.[0] ?? ""]));
      return setErrors({ ...det, form: r.details ? "" : r.error });
    }
    setForm({ displayName: "", phoneNumber: "" });
    setErrors({});
    setAddOpen(false);
    toast("Number registered");
    onChanged();
  }
  async function toggle(id: string, status: string) {
    setBusy(id);
    const r = await apiFetch(`/api/admin/whatsapp-accounts/${id}`, { method: "PATCH", body: { status: status === "disabled" ? "pending" : "disabled" } });
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    onChanged();
  }
  async function remove() {
    if (!removeTarget) return;
    setBusy(removeTarget.id);
    const r = await apiFetch(`/api/admin/whatsapp-accounts/${removeTarget.id}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    setRemoveTarget(null);
    toast("Number removed");
    onChanged();
  }

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Registry only">
        Numbers are recorded here and stay <strong>Pending connection</strong>. Linking them to the Meta WhatsApp Cloud API ships in the WhatsApp phase.
      </Alert>
      <Card>
        <CardHeader
          title="WhatsApp numbers"
          description={`${o.whatsappAccounts.filter((a) => a.status !== "disabled").length} of ${d.plan ? limitLabel(d.plan.maxWhatsAppNumbers) : "—"} allowed by plan`}
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus aria-hidden="true" /> Add number
            </Button>
          }
        />
        {o.whatsappAccounts.length === 0 ? (
          <EmptyState icon={Phone} title="No numbers registered" description="Register the client's WhatsApp Business number to prepare for connection." />
        ) : (
          <Table caption="WhatsApp numbers">
            <THead>
              <tr>
                <TH>Display name</TH>
                <TH>Number</TH>
                <TH>Status</TH>
                <TH>Added</TH>
                <TH className="text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {o.whatsappAccounts.map((a) => (
                <TR key={a.id}>
                  <TD className="font-medium">{a.displayName}</TD>
                  <TD className="font-mono text-small">{a.phoneNumber}</TD>
                  <TD>
                    <Badge tone={a.status === "connected" ? "success" : a.status === "disabled" ? "neutral" : "warning"} dot>
                      {WHATSAPP_STATUS_LABELS[a.status] ?? a.status}
                    </Badge>
                  </TD>
                  <TD className="text-app-muted">{dateFmt.format(new Date(a.createdAt))}</TD>
                  <TD className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => toggle(a.id, a.status)}>
                      {a.status === "disabled" ? "Enable" : "Disable"}
                    </Button>
                    <IconButton label={`Remove ${a.phoneNumber}`} size="sm" disabled={busy === a.id} onClick={() => setRemoveTarget(a)}>
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Register WhatsApp number">
        <form onSubmit={add} noValidate className="space-y-4">
          {errors.form ? <Alert tone="danger">{errors.form}</Alert> : null}
          <Field id="wa-name" label="Display name" error={errors.displayName}>
            <Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} placeholder="e.g. Sales" />
          </Field>
          <Field id="wa-number" label="Phone number" hint="International format. A 10-digit Indian number gets +91 automatically." error={errors.phoneNumber}>
            <Input type="tel" value={form.phoneNumber} onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))} placeholder="+91 98765 43210" />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Register number
            </Button>
          </div>
        </form>
      </Modal>
      <ConfirmationDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={remove}
        loading={busy === removeTarget?.id}
        title="Remove number?"
        description={`${removeTarget?.phoneNumber ?? ""} is removed from this client's registry.`}
        confirmLabel="Remove"
      />
    </div>
  );
}

type PlanOption = { id: string; name: string; priceMonthly: number; isActive: boolean; maxUsers: number; maxWhatsAppNumbers: number; maxMonthlyMessages: number; maxContacts: number };

export function PlanTab({ d, onChanged }: { d: ClientDetail; onChanged: () => void }) {
  const toast = useToast();
  const [plans, setPlans] = React.useState<PlanOption[] | null>(null);
  const [selected, setSelected] = React.useState(d.plan?.id ?? "");
  const [mode, setMode] = React.useState<"complimentary" | "invoiced">("complimentary");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    void apiFetch<{ plans: PlanOption[] }>("/api/admin/plans").then((r) => {
      if (r.ok) setPlans(r.data.plans.filter((p) => p.isActive || p.id === d.plan?.id));
    });
  }, [d.plan?.id]);

  async function assign() {
    setSaving(true);
    setError("");
    const r = await apiFetch(`/api/admin/organizations/${d.organization.id}/plan`, { method: "PUT", body: { planId: selected, billingMode: mode } });
    setSaving(false);
    if (!r.ok) return setError(r.error);
    toast("Plan updated");
    onChanged();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Current plan" />
        <CardBody>
          {d.plan ? (
            <>
              <p className="text-h2 text-app-text">{d.plan.name}</p>
              <p className="text-body text-app-muted">{formatINR(d.plan.priceMonthly)} / month (list price)</p>
              <ul className="mt-4 space-y-1.5 text-small text-app-muted">
                <li>{limitLabel(d.plan.maxUsers)} team seats</li>
                <li>{limitLabel(d.plan.maxWhatsAppNumbers)} WhatsApp number(s)</li>
                <li>{limitLabel(d.plan.maxMonthlyMessages)} messages / month</li>
                <li>{limitLabel(d.plan.maxContacts)} new contacts / month</li>
              </ul>
            </>
          ) : (
            <Alert tone="warning">No plan assigned.</Alert>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Change plan" description="Ends the current subscription and starts the new one today. Logged as “Plan changed”." />
        <CardBody className="space-y-4">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {plans === null ? (
            <LoadingState className="py-4" />
          ) : (
            <Field id="plan-select" label="Plan">
              <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
                <option value="" disabled>
                  Select a plan
                </option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatINR(p.priceMonthly)}/mo · {limitLabel(p.maxUsers)} seats · {limitLabel(p.maxWhatsAppNumbers)} number(s)
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field id="plan-billing" label="Billing" hint={mode === "invoiced" ? "An invoice for the first month is issued now, then one every month. Unpaid invoices pause sending after the grace period." : "Contracted by MECGURA: no automatic invoices (you collect outside the platform)."}>
            <Select value={mode} onChange={(e) => setMode(e.target.value as "complimentary" | "invoiced")}>
              <option value="complimentary">Contracted — don&apos;t invoice automatically</option>
              <option value="invoiced">Invoiced every month</option>
            </Select>
          </Field>
          <div className="flex justify-end">
            <Button loading={saving} disabled={!selected || selected === d.plan?.id} onClick={assign}>
              Assign plan
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export function UsageTab({ d }: { d: ClientDetail }) {
  return (
    <Card>
      <CardHeader title="Usage this month" description="Messages and contacts are metered once the WhatsApp and CRM modules are connected." />
      <CardBody className="grid gap-6 sm:grid-cols-2">
        {d.usage.map((u) => (
          <UsageMeter key={u.key} label={u.label} used={u.used} limit={u.limit} />
        ))}
      </CardBody>
    </Card>
  );
}

export function BillingTab({ d }: { d: ClientDetail }) {
  const subs = d.organization.subscriptions;
  const current = subs.find((s) => s.status === "active");
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Real payments only">
        Revenue is counted only from invoices that were actually paid — through a connected gateway or recorded by you with a reference. Manage them in Billing &amp; Plans → Invoices.
      </Alert>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-small text-app-muted">Monthly price</p>
          <p className="mt-1 text-h1 text-app-text">{current ? formatINR(current.priceMonthly) : "—"}</p>
          <p className="text-caption text-app-subtle">Locked at assignment</p>
        </Card>
        <Card className="p-5">
          <p className="text-small text-app-muted">Contributes to MRR</p>
          <p className="mt-1 text-h1 text-app-text">{current && d.organization.status === "active" ? formatINR(current.priceMonthly) : formatINR(0)}</p>
          <p className="text-caption text-app-subtle">{d.organization.status === "active" ? "Active client" : "Suspended — excluded"}</p>
        </Card>
        <Card className="p-5">
          <p className="text-small text-app-muted">Customer since</p>
          <p className="mt-1 text-h1 text-app-text">{subs.length ? dateFmt.format(new Date(subs[subs.length - 1].startedAt)) : "—"}</p>
        </Card>
      </div>
      <Card>
        <CardHeader title="Subscription history" />
        {subs.length === 0 ? (
          <EmptyState icon={ScrollText} title="No subscriptions yet" />
        ) : (
          <Table caption="Subscription history">
            <THead>
              <tr>
                <TH>Plan</TH>
                <TH>Price / month</TH>
                <TH>Started</TH>
                <TH>Ended</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {subs.map((s) => (
                <TR key={s.id}>
                  <TD className="font-medium">{s.plan.name}</TD>
                  <TD className="tabular-nums">{formatINR(s.priceMonthly)}</TD>
                  <TD className="text-app-muted">{dateFmt.format(new Date(s.startedAt))}</TD>
                  <TD className="text-app-muted">{s.endedAt ? dateFmt.format(new Date(s.endedAt)) : "—"}</TD>
                  <TD>
                    <Badge tone={s.status === "active" ? "success" : "neutral"}>{s.status === "active" ? "Current" : "Ended"}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

type Log = { id: string; action: string; metadata: string; createdAt: string; actor: { name: string | null; email: string } | null };

export function ActivityTab({ organizationId }: { organizationId: string }) {
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<{ items: Log[]; total: number; pageSize: number } | null>(null);
  const [error, setError] = React.useState("");
  const load = React.useCallback(async () => {
    setError("");
    const r = await apiFetch<{ items: Log[]; total: number; pageSize: number }>(`/api/organizations/${organizationId}/audit-logs?page=${page}&pageSize=15`);
    if (!r.ok) return setError(r.error);
    setData(r.data);
  }, [organizationId, page]);
  React.useEffect(() => {
    // Fetch on mount / page change (external data sync).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader title="Activity" description="Everything recorded for this client" />
      {error ? (
        <ErrorState description={error} onRetry={load} />
      ) : !data ? (
        <LoadingState />
      ) : data.items.length === 0 ? (
        <EmptyState icon={Activity} title="No activity yet" />
      ) : (
        <>
          <ul className="divide-y divide-app-border">
            {data.items.map((l) => (
              <li key={l.id} className="flex items-start gap-3 px-5 py-3">
                <Avatar name={l.actor?.name ?? l.actor?.email ?? "?"} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-body text-app-text">{describeAction(l.action)}</p>
                  <p className="truncate text-caption text-app-subtle">
                    {l.actor?.name ?? l.actor?.email ?? "Anonymous"}
                    {l.metadata !== "{}" ? ` · ${l.metadata}` : ""}
                  </p>
                </div>
                <time dateTime={l.createdAt} className="shrink-0 text-caption text-app-subtle">
                  {dateTimeFmt.format(new Date(l.createdAt))}
                </time>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        </>
      )}
    </Card>
  );
}

export function roleLabel(role: string) {
  return isOrgRole(role) ? ORG_ROLE_LABELS[role] : role;
}
