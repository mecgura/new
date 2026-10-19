"use client";

import * as React from "react";
import { Alert, Button, Card, CardBody, ErrorState, LoadingState, PageHeader, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Pack = { id: string; name: string; description: string; tags: number; faqs: number; templates: number };
type Result = { pack: string; tags: number; agent: string; templates: number; templatesNote: string };

export function PacksApp({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const base = `/api/organizations/${orgId}/industry-packs`;
  const toast = useToast();
  const [packs, setPacks] = React.useState<Pack[] | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [result, setResult] = React.useState<Result | null>(null);

  const load = React.useCallback(async () => {
    const r = await apiFetch<{ packs: Pack[] }>(base);
    if (!r.ok) return setError(r.error);
    setError("");
    setPacks(r.data.packs);
  }, [base]);
  React.useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function apply(id: string) {
    setBusy(id);
    const r = await apiFetch<Result>(base, { method: "POST", body: { packId: id } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    setResult(r.data);
  }

  if (error) return <ErrorState description={error} onRetry={load} />;
  if (!packs) return <LoadingState />;
  return (
    <>
      <PageHeader title="Industry packs" description="Starter tags, an AI assistant draft and message-template drafts for your kind of business. Edit everything before you use it." />
      {result ? (
        <Alert tone="success" className="mb-4" title={`${result.pack} added`}>
          {result.tags} tag(s) added · AI assistant: {result.agent} · {result.templates} template draft(s) added.
          {result.templatesNote ? ` ${result.templatesNote}` : ""} Nothing was sent to customers or submitted to Meta; review the drafts in Templates and AI Agent first.
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        {packs.map((p) => (
          <Card key={p.id}>
            <CardBody>
              <p className="font-semibold text-app-text">{p.name}</p>
              <p className="mt-1 text-small text-app-muted">{p.description}</p>
              <p className="mt-2 text-small text-app-muted">
                {p.tags} tags · {p.faqs} FAQ answers · {p.templates} template drafts
              </p>
              {canManage ? (
                <Button className="mt-3" size="sm" loading={busy === p.id} onClick={() => apply(p.id)}>
                  Add to my workspace
                </Button>
              ) : null}
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
