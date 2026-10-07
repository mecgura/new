"use client";

import * as React from "react";
import Link from "next/link";
import { FileText, Plus, RefreshCw } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
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
  buttonVariants,
  useToast,
} from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { CATEGORY_LABELS, STATUS_LABELS, TEMPLATE_CATEGORIES, TEMPLATE_LANGUAGES, type TemplateStatus } from "@/lib/templates";
import { dayFmt } from "@/components/inbox/types";
import { useRealtime } from "@/components/inbox/use-realtime";
import { QUALITY, STATUS_TONE, wabaLabel, type TemplateAccount, type TemplateView } from "@/components/templates/types";

const TABS = [
  { id: "", label: "All", key: "all" },
  { id: "draft", label: "Draft", key: "draft" },
  { id: "pending", label: "Pending", key: "pending" },
  { id: "approved", label: "Approved", key: "approved" },
  { id: "rejected", label: "Rejected", key: "rejected" },
];

const langLabel = (code: string) => TEMPLATE_LANGUAGES.find((l) => l.code === code)?.label ?? code;

export function TemplatesApp({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const toast = useToast();
  const [status, setStatus] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [wabaId, setWabaId] = React.useState("");
  const [q, setQ] = React.useState("");
  const [data, setData] = React.useState<{ templates: TemplateView[]; counts: Record<string, number>; accounts: TemplateAccount[] } | null>(null);
  const [error, setError] = React.useState("");
  const [syncing, setSyncing] = React.useState(false);
  const qs = new URLSearchParams({ status, category, wabaId, q }).toString();

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ templates: TemplateView[]; counts: Record<string, number>; accounts: TemplateAccount[] }>(`/api/organizations/${orgId}/templates?${qs}`);
    if (!r.ok) return setError(r.error);
    setError("");
    setData(r.data);
  }, [orgId, qs]);

  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 200);
    return () => window.clearTimeout(t);
  }, [load]);
  // Review results from Meta arrive by webhook → pushed over SSE.
  useRealtime(orgId, (e) => e.type === "template.updated" && void load(), load);

  const live = data?.accounts.filter((a) => !a.isDemo) ?? [];

  async function sync() {
    setSyncing(true);
    let created = 0;
    let updated = 0;
    for (const a of live) {
      const r = await apiFetch<{ created: number; updated: number }>(`/api/organizations/${orgId}/templates/sync`, { method: "POST", body: { wabaId: a.id } });
      if (!r.ok) {
        toast(`${a.name}: ${r.error}`, "error");
        continue;
      }
      created += r.data.created;
      updated += r.data.updated;
    }
    setSyncing(false);
    toast(`Synced from Meta — ${created} new, ${updated} updated`);
    void load();
  }

  return (
    <>
      <PageHeader
        title="Templates"
        description="Pre-approved WhatsApp messages for starting conversations, campaigns and notifications."
        actions={
          canManage ? (
            <>
              {live.length ? (
                <Button variant="secondary" onClick={sync} loading={syncing}>
                  <RefreshCw aria-hidden="true" /> Sync from Meta
                </Button>
              ) : null}
              {data?.accounts.length ? (
                <Link href="/templates/new" className={buttonVariants()}>
                  <Plus aria-hidden="true" /> New template
                </Link>
              ) : null}
            </>
          ) : null
        }
      />
      {data && !data.accounts.length ? (
        <Alert tone="info" title="Connect a WhatsApp number first" className="mb-4">
          Templates belong to a WhatsApp Business Account. <Link href="/whatsapp/connect" className="underline">Connect a number</Link> (or create a demo number) to start.
        </Alert>
      ) : null}
      <Card>
        <Tabs label="Template status" items={TABS.map((t) => ({ id: t.id || "all", label: `${t.label} ${data?.counts[t.key] ?? ""}`.trim() }))} value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)} className="px-2" />
        <FilterBar>
          <SearchBar label="Search templates" placeholder="Search name or text…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:w-64" />
          <Select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)} className="sm:w-44">
            <option value="">All categories</option>
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </Select>
          {data && data.accounts.length > 1 ? (
            <Select aria-label="Filter by WhatsApp account" value={wabaId} onChange={(e) => setWabaId(e.target.value)} className="sm:w-56">
              <option value="">All accounts</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>{wabaLabel(a)}</option>
              ))}
            </Select>
          ) : null}
        </FilterBar>
        {error ? (
          <ErrorState description={error} onRetry={load} />
        ) : !data ? (
          <LoadingState />
        ) : !data.templates.length ? (
          <EmptyState
            icon={FileText}
            title={q || category || status ? "No templates match" : "No templates yet"}
            description="Create a template, submit it for Meta review, and use it once approved."
            action={canManage && data.accounts.length ? <Link href="/templates/new" className={buttonVariants()}>New template</Link> : undefined}
          />
        ) : (
          <Table caption="Message templates" className="min-w-[860px]">
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Category</TH>
                <TH>Language</TH>
                <TH>Status</TH>
                <TH>Quality</TH>
                <TH>Account</TH>
                <TH>Updated</TH>
              </tr>
            </THead>
            <TBody>
              {data.templates.map((t) => (
                <TR key={t.id}>
                  <TD>
                    <Link href={`/templates/${t.id}`} className="font-mono text-small font-medium hover:text-app-primary-hover">
                      {t.name}
                    </Link>
                    <p className="max-w-[18rem] truncate text-caption text-app-subtle">{t.category === "AUTHENTICATION" ? "One-time passcode" : t.body || "—"}</p>
                  </TD>
                  <TD>{CATEGORY_LABELS[t.category]}</TD>
                  <TD className="text-app-muted">{langLabel(t.language)}</TD>
                  <TD>
                    <Badge tone={STATUS_TONE[t.status]} dot>{STATUS_LABELS[t.status as TemplateStatus]}</Badge>
                    {t.status === "rejected" && t.rejectedReason ? <p className="mt-0.5 max-w-[14rem] truncate text-caption text-red-300" title={t.rejectedReason}>{t.rejectedReason}</p> : null}
                  </TD>
                  <TD>{t.status === "approved" ? <Badge tone={QUALITY[t.qualityScore]?.tone ?? "neutral"}>{QUALITY[t.qualityScore]?.label ?? t.qualityScore}</Badge> : <span className="text-app-subtle">—</span>}</TD>
                  <TD className="max-w-[12rem] truncate text-small text-app-muted">{wabaLabel(t.waba)}</TD>
                  <TD className="whitespace-nowrap text-small text-app-muted">{dayFmt.format(new Date(t.updatedAt))}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
