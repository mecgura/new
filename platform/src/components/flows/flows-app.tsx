"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarCheck, ClipboardList, FilePlus2, MessageSquareHeart, Package, ShoppingBag, UserPlus } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  SearchBar,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  type BadgeTone,
} from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { formatNumber } from "@/lib/catalog";
import { CATEGORY_LABELS, FLOW_TEMPLATES, type FlowCategory, type FlowTemplateKey } from "@/lib/flows";
import { istFmt } from "@/components/campaigns/types";

type Waba = { id: string; name: string; isDemo: boolean; accounts: { id: string; displayName: string; phoneNumber: string }[] };
type Item = { id: string; name: string; category: FlowCategory; status: string; isDemo: boolean; submissions: number; updatedAt: string; waba: { name: string; isDemo: boolean } | null };

export const FLOW_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  published: { label: "Published", tone: "success" },
  deprecated: { label: "Retired", tone: "warning" },
};

const ICONS: Record<FlowTemplateKey | "custom", React.ElementType> = {
  appointment: CalendarCheck,
  lead: UserPlus,
  product: ShoppingBag,
  feedback: MessageSquareHeart,
  order: Package,
  custom: FilePlus2,
};

export function FlowsApp({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [tab, setTab] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [data, setData] = React.useState<{ flows: Item[]; counts: Record<string, number>; accounts: Waba[] } | null>(null);
  const [error, setError] = React.useState("");
  const [create, setCreate] = React.useState<FlowTemplateKey | "custom" | null>(null);
  const qs = new URLSearchParams({ status: tab === "all" ? "" : tab, q }).toString();
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ flows: Item[]; counts: Record<string, number>; accounts: Waba[] }>(`/api/organizations/${orgId}/flows?${qs}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [orgId, qs]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);

  const templates = [...(Object.keys(FLOW_TEMPLATES) as FlowTemplateKey[]).map((k) => ({ key: k, ...FLOW_TEMPLATES[k] })), { key: "custom" as const, name: "Blank flow", category: "OTHER" as FlowCategory, description: "Start from one screen and build your own form." }];

  return (
    <>
      <PageHeader title="WhatsApp Flows" description="In-chat forms customers fill without leaving WhatsApp. Every submission updates the contact in your CRM." />
      {data && !data.accounts.length ? (
        <Alert tone="info" className="mb-4" title="Connect a WhatsApp number first">
          Flows belong to a WhatsApp Business Account. <Link href="/whatsapp/connect" className="underline">Connect a number</Link> (or a demo number) to create one.
        </Alert>
      ) : null}
      {canManage && data?.accounts.length ? (
        <Card className="mb-4">
          <CardHeader title="Create a flow" description="Start from a ready-made form — every part is editable." />
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((t) => {
              const Icon = ICONS[t.key];
              return (
                <button key={t.key} type="button" onClick={() => setCreate(t.key)} className="flex items-start gap-3 rounded-xl border border-app-border bg-app-elevated p-3 text-left transition-colors hover:border-app-primary/60">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-app-primary-soft text-app-primary">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-small font-semibold text-app-text">{t.name}</span>
                    <span className="block text-caption text-app-muted">{t.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}
      <Card>
        <Tabs label="Flow status" items={["all", "draft", "published", "deprecated"].map((s) => ({ id: s, label: `${s === "all" ? "All" : FLOW_STATUS[s].label} ${data?.counts[s] ?? ""}`.trim() }))} value={tab} onValueChange={setTab} className="px-2" />
        <FilterBar>
          <SearchBar label="Search flows" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-72" />
        </FilterBar>
        {error ? (
          <ErrorState description={error} onRetry={load} />
        ) : !data ? (
          <LoadingState />
        ) : !data.flows.length ? (
          <EmptyState icon={ClipboardList} title={q || tab !== "all" ? "No flows match" : "No flows yet"} description="Pick a template above to create your first form." />
        ) : (
          <Table caption="WhatsApp Flows" className="min-w-[720px]">
            <THead>
              <tr>
                <TH>Flow</TH>
                <TH>Category</TH>
                <TH>Status</TH>
                <TH className="text-right">Submissions</TH>
                <TH>Updated</TH>
              </tr>
            </THead>
            <TBody>
              {data.flows.map((f) => (
                <TR key={f.id}>
                  <TD>
                    <Link href={`/flows/${f.id}`} className="font-medium hover:text-app-primary-hover">{f.name}</Link>
                    <p className="text-caption text-app-subtle">{f.waba?.name}{f.isDemo ? " · demo" : ""}</p>
                  </TD>
                  <TD className="text-small">{CATEGORY_LABELS[f.category]}</TD>
                  <TD>
                    <Badge tone={FLOW_STATUS[f.status]?.tone ?? "neutral"} dot>{FLOW_STATUS[f.status]?.label ?? f.status}</Badge>
                  </TD>
                  <TD className="text-right tabular-nums">{formatNumber(f.submissions)}</TD>
                  <TD className="whitespace-nowrap text-small text-app-muted">{istFmt.format(new Date(f.updatedAt))}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {create && data ? <CreateModal orgId={orgId} template={create} accounts={data.accounts} onClose={() => setCreate(null)} /> : null}
    </>
  );
}

function CreateModal({ orgId, template, accounts, onClose }: { orgId: string; template: FlowTemplateKey | "custom"; accounts: Waba[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = React.useState(template === "custom" ? "" : FLOW_TEMPLATES[template].name);
  const [wabaId, setWabaId] = React.useState(accounts[0]?.id ?? "");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await apiFetch<{ flow: { id: string } }>(`/api/organizations/${orgId}/flows`, { method: "POST", body: { name, wabaId, template } });
    setBusy(false);
    if (!r.ok) return setError(r.details?.name?.[0] ?? r.error);
    router.push(`/flows/${r.data.flow.id}`);
  }
  return (
    <Modal open onClose={onClose} title={template === "custom" ? "New blank flow" : `New ${FLOW_TEMPLATES[template].name} flow`}>
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field id="nf-name" label="Flow name" hint="Shown in WhatsApp Manager; must be unique.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field id="nf-waba" label="WhatsApp account">
          <Select value={wabaId} onChange={(e) => setWabaId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name || "WhatsApp account"} · {a.accounts.map((x) => x.displayName).join(", ")}{a.isDemo ? " (demo)" : ""}</option>
            ))}
          </Select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>Create & edit</Button>
        </div>
      </form>
    </Modal>
  );
}
