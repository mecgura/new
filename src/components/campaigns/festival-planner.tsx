"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarHeart, FileText, Megaphone } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, EmptyState, Input, Label, LoadingState, PageHeader, Select, Textarea, useToast, type BadgeTone } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Planner = {
  businessName: string;
  numbers: { id: string; wabaId: string; label: string }[];
  festivals: {
    id: string;
    name: string;
    emoji: string;
    start: string;
    inDays: number;
    templateName: string;
    templates: { id: string; status: string; wabaId: string }[];
    campaign: { id: string; status: string; scheduledAt: string | null } | null;
  }[];
};

const TPL_TONE: Record<string, BadgeTone> = { draft: "neutral", pending: "warning", approved: "success", rejected: "danger", paused: "warning", disabled: "danger" };
const TPL_LABEL: Record<string, string> = { draft: "Draft: submit to Meta", pending: "Waiting for Meta", approved: "Approved", rejected: "Rejected by Meta", paused: "Paused", disabled: "Disabled" };
const dateFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const whenFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function FestivalPlanner({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [data, setData] = React.useState<Planner | null>(null);
  const [error, setError] = React.useState("");
  const [numberId, setNumberId] = React.useState("");
  const [business, setBusiness] = React.useState("");
  const [offers, setOffers] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const base = `/api/organizations/${orgId}/campaigns/festivals`;

  const load = React.useCallback(
    () =>
      apiFetch<Planner>(base).then((r) => {
        if (!r.ok) return setError(r.error);
        setData(r.data);
        setNumberId((n) => n || r.data.numbers[0]?.id || "");
        setBusiness((b) => b || r.data.businessName);
      }),
    [base]
  );
  React.useEffect(() => {
    void load();
  }, [load]);

  const number = data?.numbers.find((n) => n.id === numberId);

  async function makeTemplate(festivalId: string) {
    if (!number) return;
    setBusy(`t:${festivalId}`);
    const r = await apiFetch<{ templateId: string; created: boolean }>(base, { method: "POST", body: { action: "template", festivalId, wabaId: number.wabaId, businessName: business, offer: offers[festivalId] ?? "" } });
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    toast(r.data.created ? "Greeting template drafted. Check it and submit it to Meta." : "Template already exists.");
    router.push(`/templates/${r.data.templateId}`);
  }

  async function makeCampaign(festivalId: string) {
    if (!number) return;
    setBusy(`c:${festivalId}`);
    const r = await apiFetch<{ campaignId: string; created: boolean }>(base, { method: "POST", body: { action: "campaign", festivalId, whatsappAccountId: number.id } });
    setBusy(null);
    if (!r.ok) return toast(r.error, "error");
    router.push(`/campaigns/${r.data.campaignId}`);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Festival campaigns"
        description="Send festival wishes and offers to your opted-in customers on WhatsApp. Plan a week or two early: Meta has to approve the greeting first."
        breadcrumb={[{ label: "Campaigns", href: "/campaigns" }, { label: "Festivals" }]}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!data && !error ? <LoadingState /> : null}
      {data ? (
        <>
          <Card>
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="fc-number">Send from</Label>
                {data.numbers.length ? (
                  <Select id="fc-number" value={numberId} onChange={(e) => setNumberId(e.target.value)}>
                    {data.numbers.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                  </Select>
                ) : (
                  <p className="text-small text-app-muted">Connect a WhatsApp number first.</p>
                )}
              </div>
              <div>
                <Label htmlFor="fc-business">Signed as (your business name)</Label>
                <Input id="fc-business" value={business} maxLength={60} onChange={(e) => setBusiness(e.target.value)} />
              </div>
              <p className="text-caption text-app-subtle sm:col-span-2">
                How it works: 1) create the greeting template and submit it to Meta, 2) set up the campaign. It is scheduled for 9:30 am on the festival day and goes only to opted-in contacts. You review and confirm before anything is sent. Meta charges its marketing message rate.
              </p>
            </CardBody>
          </Card>

          {!data.festivals.length ? <EmptyState icon={CalendarHeart} title="No festivals in the next 60 days" description="New festivals appear here as they come closer." /> : null}

          {data.festivals.map((f) => {
            const tpl = f.templates.find((t) => t.wabaId === number?.wabaId) ?? null;
            const late = f.inDays < 3 && tpl?.status !== "approved";
            return (
              <Card key={f.id}>
                <CardBody className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="grid size-12 place-items-center rounded-2xl bg-app-hover text-2xl" aria-hidden="true">{f.emoji || "🎉"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-h3 text-app-text">{f.name}</p>
                      <p className="text-small text-app-muted">{dateFmt.format(new Date(`${f.start}T00:00:00Z`))} · {f.inDays === 0 ? "today" : f.inDays === 1 ? "tomorrow" : `in ${f.inDays} days`}</p>
                    </div>
                    {f.campaign ? <Badge tone="info">Campaign {f.campaign.status}{f.campaign.scheduledAt ? ` · ${whenFmt.format(new Date(f.campaign.scheduledAt))}` : ""}</Badge> : null}
                  </div>
                  {late ? <Alert tone="warning">Meta approval can take a few hours to a day. Start now to be ready on time.</Alert> : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-[var(--radius-control)] border border-app-border p-4">
                      <p className="flex items-center gap-2 font-semibold text-app-text"><FileText className="size-4" aria-hidden="true" /> 1. Greeting template</p>
                      {tpl ? (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <Badge tone={TPL_TONE[tpl.status] ?? "neutral"}>{TPL_LABEL[tpl.status] ?? tpl.status}</Badge>
                          <Link href={`/templates/${tpl.id}`} className="text-small font-semibold text-app-primary hover:underline">Open template</Link>
                        </div>
                      ) : (
                        <div className="mt-3 space-y-3">
                          <div>
                            <Label htmlFor={`fo-${f.id}`}>Your offer (optional)</Label>
                            <Textarea id={`fo-${f.id}`} rows={2} maxLength={300} placeholder={`${f.name} special: 20% off till Sunday. Reply YES to book.`} value={offers[f.id] ?? ""} onChange={(e) => setOffers((o) => ({ ...o, [f.id]: e.target.value }))} />
                          </div>
                          <p className="whitespace-pre-line rounded-lg bg-app-hover p-3 text-small text-app-text">
                            {`Hi Ravi, wishing you and your family a very Happy ${f.name}! ${f.emoji}${offers[f.id]?.trim() ? `\n\n${offers[f.id].trim()}` : ""}\n\nWarm wishes,\n${business || "Your business"}`}
                          </p>
                          <Button size="sm" disabled={!canManage || !number} loading={busy === `t:${f.id}`} onClick={() => makeTemplate(f.id)}>Create template</Button>
                        </div>
                      )}
                    </div>
                    <div className="rounded-[var(--radius-control)] border border-app-border p-4">
                      <p className="flex items-center gap-2 font-semibold text-app-text"><Megaphone className="size-4" aria-hidden="true" /> 2. Campaign</p>
                      {f.campaign ? (
                        <div className="mt-3">
                          <Link href={`/campaigns/${f.campaign.id}`} className="text-small font-semibold text-app-primary hover:underline">Open campaign</Link>
                        </div>
                      ) : (
                        <div className="mt-3 space-y-2">
                          <p className="text-small text-app-muted">
                            {tpl?.status === "approved" ? "Template approved. The campaign will use it, with each customer's first name." : "You can set it up now and pick the template once Meta approves it."}
                          </p>
                          <Button size="sm" variant={tpl?.status === "approved" ? "primary" : "secondary"} disabled={!canManage || !number} loading={busy === `c:${f.id}`} onClick={() => makeCampaign(f.id)}>Set up campaign</Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
