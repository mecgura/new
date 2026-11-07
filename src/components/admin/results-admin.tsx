"use client";

import * as React from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { Alert, Button, Card, CardBody, Checkbox, Field, Input, LoadingState, PageHeader, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import type { CaseStudy } from "@/services/site/results";

const blank = (): CaseStudy => ({ id: `case-${Date.now().toString(36)}`, business: "", type: "", city: "", challenge: "", solution: "", results: [], quote: "", quoteBy: "", clientApproved: false, published: false });

/** Admin → Case studies: real client results for mecgura.tech/results. Nothing shows until published with the client's OK. */
export function ResultsAdmin() {
  const toast = useToast();
  const [items, setItems] = React.useState<CaseStudy[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    void apiFetch<{ items: CaseStudy[] }>("/api/admin/site-results").then((r) => (r.ok ? setItems(r.data.items) : toast(r.error, "error")));
  }, [toast]);

  const patch = (i: number, p: Partial<CaseStudy>) => setItems((l) => l!.map((x, j) => (j === i ? { ...x, ...p } : x)));
  async function save() {
    setBusy(true);
    const r = await apiFetch<{ items: CaseStudy[] }>("/api/admin/site-results", { method: "PUT", body: { items } });
    setBusy(false);
    if (!r.ok) return toast(Object.values(r.details ?? {})[0]?.[0] ?? r.error, "error");
    setItems(r.data.items);
    toast("Saved. Published case studies are live on /results");
  }
  if (!items) return <LoadingState />;
  return (
    <>
      <PageHeader title="Case studies" description="Real results from real clients, shown on mecgura.tech/results. Only publish numbers you can prove, with the client's permission." actions={<Button onClick={() => void save()} disabled={busy}><Save aria-hidden="true" /> Save</Button>} />
      <Alert tone="warning" className="mb-4" title="Rules">No made-up numbers or names. Each case study needs “client agreed” ticked before it can be published. Until you publish one, the Results page stays hidden.</Alert>
      <div className="space-y-4">
        {items.map((c, i) => (
          <Card key={c.id}>
            <CardBody className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id={`cs-b-${i}`} label="Business"><Input value={c.business} maxLength={80} onChange={(e) => patch(i, { business: e.target.value })} /></Field>
                <Field id={`cs-t-${i}`} label="Type (e.g. Salon)"><Input value={c.type} maxLength={60} onChange={(e) => patch(i, { type: e.target.value })} /></Field>
                <Field id={`cs-c-${i}`} label="City"><Input value={c.city} maxLength={60} onChange={(e) => patch(i, { city: e.target.value })} /></Field>
              </div>
              <Field id={`cs-ch-${i}`} label="The problem"><Textarea rows={2} maxLength={400} value={c.challenge} onChange={(e) => patch(i, { challenge: e.target.value })} /></Field>
              <Field id={`cs-s-${i}`} label="What you set up"><Textarea rows={2} maxLength={500} value={c.solution} onChange={(e) => patch(i, { solution: e.target.value })} /></Field>
              <div>
                <p className="mb-1.5 text-small font-medium text-app-text">Results (up to 4, real numbers only)</p>
                {c.results.map((r, k) => (
                  <div key={k} className="mb-2 flex gap-2">
                    <Input aria-label="Label" placeholder="Leads per month" value={r.label} onChange={(e) => patch(i, { results: c.results.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)) })} />
                    <Input aria-label="Value" placeholder="120" value={r.value} onChange={(e) => patch(i, { results: c.results.map((x, j) => (j === k ? { ...x, value: e.target.value } : x)) })} />
                    <Button variant="ghost" size="sm" onClick={() => patch(i, { results: c.results.filter((_, j) => j !== k) })}>Remove</Button>
                  </div>
                ))}
                {c.results.length < 4 ? <Button variant="secondary" size="sm" onClick={() => patch(i, { results: [...c.results, { label: "", value: "" }] })}><Plus aria-hidden="true" /> Add result</Button> : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id={`cs-q-${i}`} label="Client quote (optional, exact words)"><Textarea rows={2} maxLength={300} value={c.quote} onChange={(e) => patch(i, { quote: e.target.value })} /></Field>
                <Field id={`cs-qb-${i}`} label="Who said it"><Input value={c.quoteBy} maxLength={80} onChange={(e) => patch(i, { quoteBy: e.target.value })} /></Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-5">
                  <Checkbox label="The client agreed to this being published" checked={c.clientApproved} onChange={(e) => patch(i, { clientApproved: e.target.checked, ...(e.target.checked ? {} : { published: false }) })} />
                  <Checkbox label="Published on the website" checked={c.published} disabled={!c.clientApproved} onChange={(e) => patch(i, { published: e.target.checked })} />
                </div>
                <Button variant="ghost" size="sm" onClick={() => setItems((l) => l!.filter((_, j) => j !== i))}><Trash2 aria-hidden="true" /> Delete</Button>
              </div>
            </CardBody>
          </Card>
        ))}
        <Button variant="secondary" onClick={() => setItems((l) => [...(l ?? []), blank()])}><Plus aria-hidden="true" /> Add case study</Button>
      </div>
    </>
  );
}
