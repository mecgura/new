"use client";

import * as React from "react";
import Link from "next/link";
import { AlarmClock, Gauge, Hourglass, Smile } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, LoadingState, PageHeader, StatCard, Switch, Textarea, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Agent = { userId: string; name: string; role: string; status: string; openChats: number; waiting: number; breachedNow: number; repliesToday: number; medianReplyMin30d: number | null; withinTargetPct30d: number | null; csat: { answered: number; asked: number; greatPct: number | null } };
type Waiting = { id: string; channel: string; waitedMin: number; breached: boolean; assignee: string | null; lastMessagePreview: string; contact: { name: string; phone: string } };
type View = { targetMinutes: number; waiting: Waiting[]; unassignedOpen: number; team: { medianReplyMin30d: number | null; botMedianReplyMin30d: number | null; withinTargetPct30d: number | null; csat: { answered: number; asked: number; greatPct: number | null } }; agents: Agent[] };
type Sla = { firstResponseMinutes: number; alertManagers: boolean; reassignAfterMinutes: number; csat: boolean; csatQuestion: string };

const STATUS: Record<string, { label: string; dot: string }> = { online: { label: "Online", dot: "bg-green-400" }, away: { label: "Away", dot: "bg-amber-400" }, busy: { label: "Busy", dot: "bg-red-400" }, offline: { label: "Offline", dot: "bg-slate-500" } };
const mins = (m: number | null) => (m === null ? "—" : m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`);

/** Supervisor view: who is waiting right now, each agent's load and speed, CSAT, and the response-time rules. */
export function InboxMonitor({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const toast = useToast();
  const [v, setV] = React.useState<View | null>(null);
  const [sla, setSla] = React.useState<Sla | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const [a, b] = await Promise.all([apiFetch<View>(`/api/organizations/${orgId}/inbox/supervisor`), apiFetch<{ sla: Sla }>(`/api/organizations/${orgId}/inbox/sla`)]);
      if (a.ok) setV(a.data);
      if (b.ok && !sla) setSla(b.data.sla);
    }, 0);
    const i = window.setInterval(() => setN((x) => x + 1), 30_000);
    return () => { clearTimeout(t); clearInterval(i); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, n]);
  async function save() {
    if (!sla) return;
    setBusy(true);
    const r = await apiFetch<{ sla: Sla }>(`/api/organizations/${orgId}/inbox/sla`, { method: "PUT", body: sla });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setSla(r.data.sla);
    toast("Response rules saved.");
    setN((x) => x + 1);
  }
  if (!v) return <LoadingState label="Loading team…" />;
  return (
    <>
      <PageHeader title="Inbox monitor" description={`Live team view · refreshes every 30 seconds · first-reply target ${v.targetMinutes} min`} breadcrumb={[{ label: "Inbox", href: "/inbox" }, { label: "Monitor" }]} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Waiting for a reply" value={String(v.waiting.length)} icon={Hourglass} hint={`${v.waiting.filter((w) => w.breached).length} past target · ${v.unassignedOpen} open chats unassigned`} featured />
        <StatCard label="Team reply time (median)" value={mins(v.team.medianReplyMin30d)} icon={AlarmClock} hint={`AI / automations: ${mins(v.team.botMedianReplyMin30d)} · last 30 days`} />
        <StatCard label="Replied within target" value={v.team.withinTargetPct30d === null ? null : `${v.team.withinTargetPct30d}%`} icon={Gauge} hint="Last 30 days" />
        <StatCard label="CSAT “Great”" value={v.team.csat.greatPct === null ? null : `${v.team.csat.greatPct}%`} icon={Smile} hint={`${v.team.csat.answered} of ${v.team.csat.asked} answered`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Customers waiting" description="Longest wait first." />
            <CardBody className="p-0">
              {!v.waiting.length ? <p className="px-4 py-4 text-small text-green-300">Nobody is waiting. 🎉</p> : (
                <ul className="divide-y divide-app-border">
                  {v.waiting.map((w) => (
                    <li key={w.id}>
                      <Link href={`/inbox?c=${w.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-app-hover">
                        <span className="min-w-0">
                          <span className="block truncate text-small font-medium text-app-text">{w.contact.name || w.contact.phone}</span>
                          <span className="block truncate text-caption text-app-muted">{w.assignee ? `With ${w.assignee}` : "Unassigned"} · {w.channel} · {w.lastMessagePreview}</span>
                        </span>
                        <Badge tone={w.breached ? "danger" : "warning"}>{mins(w.waitedMin)}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Team" />
            <CardBody className="overflow-x-auto p-0">
              <table className="w-full text-small">
                <thead className="text-left text-caption text-app-muted"><tr className="border-b border-app-border">{["Agent", "Status", "Open chats", "Waiting", "Replies today", "Reply time", "Within target", "CSAT"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-2 font-medium">{h}</th>)}</tr></thead>
                <tbody>
                  {v.agents.map((a) => (
                    <tr key={a.userId} className="border-b border-app-border last:border-0">
                      <td className="px-4 py-2 text-app-text">{a.name}</td>
                      <td className="px-4 py-2"><span className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${STATUS[a.status]?.dot ?? "bg-slate-500"}`} aria-hidden="true" />{STATUS[a.status]?.label ?? a.status}</span></td>
                      <td className="px-4 py-2">{a.openChats}</td>
                      <td className="px-4 py-2">{a.waiting}{a.breachedNow ? <Badge tone="danger" className="ml-1">{a.breachedNow} late</Badge> : null}</td>
                      <td className="px-4 py-2">{a.repliesToday}</td>
                      <td className="px-4 py-2">{mins(a.medianReplyMin30d)}</td>
                      <td className="px-4 py-2">{a.withinTargetPct30d === null ? "—" : `${a.withinTargetPct30d}%`}</td>
                      <td className="px-4 py-2">{a.csat.greatPct === null ? "—" : `${a.csat.greatPct}% great`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
        </div>

        {sla ? (
          <Card>
            <CardHeader title="Response rules" description="Alerts go to the assignee (and managers) once per waiting customer." />
            <CardBody className="space-y-4">
              <Field id="sla-first" label="Reply to new messages within (minutes)"><Input type="number" min={1} max={1440} value={sla.firstResponseMinutes} disabled={!canEdit} onChange={(e) => setSla({ ...sla, firstResponseMinutes: Number(e.target.value) })} /></Field>
              <Switch checked={sla.alertManagers} disabled={!canEdit} onCheckedChange={(x) => setSla({ ...sla, alertManagers: x })} label="Also alert owners and managers" />
              <Field id="sla-move" label="Move to the least busy teammate after (minutes)" hint="0 = never move automatically"><Input type="number" min={0} max={1440} value={sla.reassignAfterMinutes} disabled={!canEdit} onChange={(e) => setSla({ ...sla, reassignAfterMinutes: Number(e.target.value) })} /></Field>
              <Switch checked={sla.csat} disabled={!canEdit} onCheckedChange={(x) => setSla({ ...sla, csat: x })} label="Ask “How did we do?” when a WhatsApp chat is closed" />
              {sla.csat ? <Field id="sla-q" label="Question (buttons: Great / Okay / Poor)"><Textarea rows={2} maxLength={300} value={sla.csatQuestion} disabled={!canEdit} onChange={(e) => setSla({ ...sla, csatQuestion: e.target.value })} /></Field> : null}
              {canEdit ? <Button onClick={() => void save()} loading={busy}>Save rules</Button> : null}
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
