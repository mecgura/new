"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ErrorState, Input, LoadingState } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import type { ReportData } from "@/lib/onepost-docs";

const thisMonth = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);

/** What went out this month, press results and search performance. Reach numbers are not collected, and the page says so. */
export function ReportsPanel({ orgId }: { orgId: string }) {
  const base = `/api/organizations/${orgId}/onepost`;
  const [month, setMonth] = React.useState(thisMonth());
  const [data, setData] = React.useState<ReportData | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    let live = true;
    void apiFetch<ReportData>(`${base}/reports?month=${month}`).then((r) => {
      if (!live) return;
      if (!r.ok) return setError(r.error);
      setError("");
      setData(r.data);
    });
    return () => {
      live = false;
    };
  }, [base, month]);

  return (
    <div className="mt-5 space-y-4">
      <Card>
        <CardHeader title="Monthly report" description="Posts, publishing results, press outcomes and search performance for the month." action={<a href={`${base}/reports/pdf?month=${month}`}><Button variant="secondary" type="button" tabIndex={-1}><Download aria-hidden="true" /> PDF</Button></a>} />
        <CardBody>
          <div className="max-w-xs">
            <label htmlFor="rp-month" className="mb-1.5 block text-small font-medium text-app-text">Month</label>
            <Input id="rp-month" type="month" value={month} max={thisMonth()} onChange={(e) => setMonth(e.target.value)} />
          </div>
        </CardBody>
      </Card>
      {error ? <ErrorState description={error} /> : !data ? <LoadingState label="Building the report…" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[["Posts created", data.posts.created], ["Published", data.published.reduce((a, b) => a + b.count, 0)], ["Failed", data.failed], ["Press emails sent", data.pr.sent]].map(([l, v]) => (
              <Card key={l as string}><CardBody><p className="text-caption text-app-subtle">{l}</p><p className="text-2xl font-semibold text-app-text">{v}</p></CardBody></Card>
            ))}
          </div>
          <Card>
            <CardHeader title="Published by channel" />
            <CardBody>
              {data.published.length ? <div className="flex flex-wrap gap-2">{data.published.map((p) => <Badge key={p.channel} tone="info">{p.label}: {p.count}</Badge>)}</div> : <p className="text-small text-app-muted">Nothing was published this month.</p>}
              <p className="mt-3 text-caption text-app-subtle">Press: {data.pr.sent} emailed · {data.pr.opened} opened · {data.pr.covered} covered. Reach (how many people saw each post) isn&apos;t collected yet.</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Google Search" description="Search Console, last days of the month are delayed by about two days." />
            <CardBody>
              {data.search.available && data.search.totals ? (
                <div className="space-y-3 text-small">
                  <p className="text-app-text">{data.search.totals.clicks} clicks · {data.search.totals.impressions} impressions · {(data.search.totals.ctr * 100).toFixed(1)}% click rate · position {data.search.totals.position.toFixed(1)}</p>
                  <ul className="space-y-1">{(data.search.queries ?? []).slice(0, 10).map((q) => <li key={q.key} className="flex justify-between gap-3"><span className="break-words text-app-text">{q.key}</span><span className="shrink-0 text-app-muted">{q.clicks} clicks</span></li>)}</ul>
                </div>
              ) : <Alert tone="info">{data.search.note}</Alert>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Posts this month" />
            <CardBody>
              {data.items.length ? (
                <ul className="divide-y divide-app-border text-small">
                  {data.items.map((i, k) => (
                    <li key={k} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="min-w-0 break-words text-app-text">{i.title} <span className="text-app-muted">· {i.channel}</span></span>
                      <span className="flex items-center gap-2"><Badge tone={i.status === "published" ? "success" : "danger"}>{i.status}</Badge>{i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer" className="text-app-primary hover:underline">View</a> : null}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-small text-app-muted">No posts went out this month.</p>}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
