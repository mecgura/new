"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Copy, Gift, IndianRupee, Plus, Repeat, ShoppingBag, Sparkles, UserPlus, Users } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Combobox, EmptyState, Field, FilterBar, Input, LoadingState, Modal, PageHeader, SearchBar, Select, StatCard, Switch, Tabs, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { DEFAULT_LOYALTY, type LoyaltySettings } from "@/lib/loyalty";

type Overview = {
  enabled: boolean;
  members: number;
  pointsIssued30: number;
  pointsRedeemed30: number;
  outstandingPoints: number;
  expiringSoon: number;
  sales30Rupees: number;
  purchases30: number;
  repeatRate: number | null;
  referrals: { pending: number; waiting: number; rewarded: number; rejected: number };
  flagged: number;
  lapsed: number;
};
type Member = { id: string; name: string; phone: string; balance: number; lifetime: number; expiringSoon: number; tier: string; purchases: number; spentRupees: number; lastPurchaseAt: string | null };
type Reward = { id: string; name: string; description: string; points: number; active: boolean };
type Referral = { id: string; code: string; status: "pending" | "qualified" | "rewarded" | "rejected"; flag: string; createdAt: string; referrer: { id: string; name: string; phone: string }; referee: { id: string; name: string; phone: string } };
type Card_ = {
  contact: { id: string; name: string; phone: string };
  wallet: { balance: number; lifetime: number; pending: number; expiringSoon: number; tier: string; next: { name: string; pointsToGo: number } | null };
  history: { id: string; points: number; kind: string; status: string; note: string; createdAt: string; expiresAt: string | null }[];
  lifetimeValueRupees: number;
  purchaseCount: number;
  avgOrderRupees: number;
  avgDaysBetween: number | null;
  lastPurchaseAt: string | null;
  referrals: { id: string; status: string; referee: { name: string; phone: string } }[];
  referral: { code: string; link: string; message: string } | null;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const REF_STATUS: Record<Referral["status"], { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
  pending: { label: "Waiting for first purchase", tone: "neutral" },
  qualified: { label: "Needs your approval", tone: "warning" },
  rewarded: { label: "Rewarded", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};

/** Referral & loyalty: points on purchases, rewards, tiers and customer referrals. */
export function LoyaltyApp({ orgId, canWrite, canManage }: { orgId: string; canWrite: boolean; canManage: boolean }) {
  const base = `/api/organizations/${orgId}/loyalty`;
  const [tab, setTab] = React.useState("overview");
  const [ov, setOv] = React.useState<Overview | null>(null);
  const [customer, setCustomer] = React.useState<string | null>(null);
  const [purchaseFor, setPurchaseFor] = React.useState<string | null | "">(null);
  const [tick, setTick] = React.useState(0);
  const refresh = () => setTick((t) => t + 1);

  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<Overview>(base);
      if (r.ok) setOv(r.data);
    }, 0);
    return () => clearTimeout(t);
  }, [base, tick]);

  return (
    <>
      <PageHeader
        title="Loyalty & referrals"
        description="Reward repeat customers with points, and let happy customers bring friends with their own referral link."
        actions={canWrite && ov?.enabled ? <Button onClick={() => setPurchaseFor("")}><ShoppingBag className="size-4" aria-hidden="true" /> Record purchase</Button> : null}
      />
      {ov && !ov.enabled ? (
        <Alert tone="info" className="mb-4" title="The programme is off">
          {canManage ? "Set your points, rewards and referral rules in Settings, then switch it on." : "Ask your workspace owner to switch the loyalty programme on."}
          {canManage ? <Button size="sm" variant="secondary" className="ml-2" onClick={() => setTab("settings")}>Open settings</Button> : null}
        </Alert>
      ) : null}
      <Tabs
        label="Loyalty sections"
        value={tab}
        onValueChange={setTab}
        className="mb-4"
        items={[
          { id: "overview", label: "Overview" },
          { id: "customers", label: "Customers" },
          { id: "referrals", label: `Referrals${ov?.referrals.waiting ? ` (${ov.referrals.waiting})` : ""}` },
          { id: "rewards", label: "Rewards" },
          ...(canManage ? [{ id: "settings", label: "Settings" }] : []),
        ]}
      />
      {tab === "overview" ? <OverviewTab ov={ov} onTab={setTab} /> : null}
      {tab === "customers" ? <CustomersTab base={base} tick={tick} onOpen={setCustomer} /> : null}
      {tab === "referrals" ? <ReferralsTab base={base} canManage={canManage} tick={tick} onChanged={refresh} /> : null}
      {tab === "rewards" ? <RewardsTab base={base} canManage={canManage} /> : null}
      {tab === "settings" && canManage ? <SettingsTab base={base} onSaved={refresh} /> : null}
      {customer ? <CustomerDrawer base={base} id={customer} canWrite={canWrite && Boolean(ov?.enabled)} canManage={canManage && Boolean(ov?.enabled)} onClose={() => setCustomer(null)} onPurchase={() => setPurchaseFor(customer)} onChanged={refresh} tick={tick} /> : null}
      {purchaseFor !== null ? <PurchaseDialog orgId={orgId} base={base} contactId={purchaseFor || null} onClose={() => setPurchaseFor(null)} onSaved={() => { setPurchaseFor(null); refresh(); }} /> : null}
    </>
  );
}

function OverviewTab({ ov, onTab }: { ov: Overview | null; onTab: (t: string) => void }) {
  if (!ov) return <LoadingState />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Members" value={ov.members.toLocaleString("en-IN")} icon={Users} hint="Customers with points or a purchase" />
        <StatCard label="Sales (30 days)" value={inr(ov.sales30Rupees)} icon={IndianRupee} hint={`${ov.purchases30} purchase${ov.purchases30 === 1 ? "" : "s"} recorded`} />
        <StatCard label="Repeat customers" value={ov.repeatRate === null ? null : `${ov.repeatRate}%`} icon={Repeat} hint="Bought more than once" />
        <StatCard label="Referrals rewarded" value={ov.referrals.rewarded.toLocaleString("en-IN")} icon={UserPlus} hint={`${ov.referrals.pending} waiting for a first purchase`} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Points given (30 days)" value={ov.pointsIssued30.toLocaleString("en-IN")} icon={Sparkles} />
        <StatCard label="Points redeemed (30 days)" value={ov.pointsRedeemed30.toLocaleString("en-IN")} icon={Gift} />
        <StatCard label="Points customers hold" value={ov.outstandingPoints.toLocaleString("en-IN")} icon={Sparkles} hint={ov.expiringSoon ? `${ov.expiringSoon.toLocaleString("en-IN")} expire in 30 days` : "None expiring soon"} />
        <StatCard label="Lapsed customers" value={ov.lapsed.toLocaleString("en-IN")} icon={AlertTriangle} hint="No purchase in 60+ days" />
      </div>
      {ov.flagged || ov.referrals.waiting ? (
        <Alert tone="warning" title="Referrals to review">
          {ov.referrals.waiting ? `${ov.referrals.waiting} waiting for your approval. ` : ""}
          {ov.flagged ? `${ov.flagged} flagged as possibly not genuine.` : ""}
          <Button size="sm" variant="secondary" className="ml-2" onClick={() => onTab("referrals")}>Review</Button>
        </Alert>
      ) : null}
      {ov.lapsed ? (
        <Card>
          <CardHeader title="Bring lapsed customers back" description="Tag them “Win back” in Contacts and the ready-made win-back drip (Automations) sends a comeback offer, stopping as soon as they reply." />
        </Card>
      ) : null}
    </div>
  );
}

function CustomersTab({ base, tick, onOpen }: { base: string; tick: number; onOpen: (id: string) => void }) {
  const [q, setQ] = React.useState("");
  const [rows, setRows] = React.useState<Member[] | null>(null);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ members: Member[] }>(`${base}/members${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
      if (r.ok) setRows(r.data.members);
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [base, q, tick]);
  return (
    <Card>
      <CardBody className="space-y-3">
        <FilterBar>
          <SearchBar label="Search customers" placeholder="Name or phone" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-72" />
        </FilterBar>
        {!rows ? <LoadingState /> : !rows.length ? (
          <EmptyState icon={Users} title={q ? "No match" : "No members yet"} description="Customers join when you record their first purchase." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-small">
              <thead className="text-left text-caption text-app-muted">
                <tr className="border-b border-app-border">
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 font-medium">Tier</th>
                  <th className="py-2 pr-3 font-medium">Points</th>
                  <th className="py-2 pr-3 font-medium">Spent</th>
                  <th className="py-2 pr-3 font-medium">Orders</th>
                  <th className="py-2 font-medium">Last purchase</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-b border-app-border last:border-0">
                    <td className="py-2 pr-3">
                      <button type="button" onClick={() => onOpen(m.id)} className="text-left font-medium text-app-text hover:text-app-primary">{m.name || m.phone}</button>
                      <span className="block text-caption text-app-subtle">{m.phone}</span>
                    </td>
                    <td className="py-2 pr-3">{m.tier ? <Badge tone="primary">{m.tier}</Badge> : "—"}</td>
                    <td className="py-2 pr-3 text-app-text">{m.balance.toLocaleString("en-IN")}{m.expiringSoon ? <span className="block text-caption text-amber-300">{m.expiringSoon} expiring</span> : null}</td>
                    <td className="py-2 pr-3 text-app-text">{inr(m.spentRupees)}</td>
                    <td className="py-2 pr-3 text-app-muted">{m.purchases}</td>
                    <td className="py-2 text-app-muted">{m.lastPurchaseAt ? dateFmt.format(new Date(m.lastPurchaseAt)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function CustomerDrawer({ base, id, canWrite, canManage, onClose, onPurchase, onChanged, tick }: { base: string; id: string; canWrite: boolean; canManage: boolean; onClose: () => void; onPurchase: () => void; onChanged: () => void; tick: number }) {
  const toast = useToast();
  const [card, setCard] = React.useState<Card_ | null>(null);
  const [rewards, setRewards] = React.useState<Reward[]>([]);
  const [rewardId, setRewardId] = React.useState("");
  const [adj, setAdj] = React.useState({ points: "", note: "" });
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    const [c, r] = await Promise.all([apiFetch<Card_>(`${base}/customers/${id}`), apiFetch<{ rewards: Reward[] }>(`${base}/rewards`)]);
    if (c.ok) setCard(c.data);
    else toast(c.error, "error");
    if (r.ok) setRewards(r.data.rewards.filter((x) => x.active));
  }, [base, id, toast]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, tick]);

  async function act(url: string, body: unknown, done: string) {
    setBusy(true);
    const r = await apiFetch(url, { method: "POST", body });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast(done);
    setRewardId("");
    setAdj({ points: "", note: "" });
    await load();
    onChanged();
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied.");
    } catch {
      toast("Couldn't copy. Select the text and copy it.", "error");
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={card ? card.contact.name || card.contact.phone : "Customer"} description={card ? <>{card.contact.phone} · <Link href={`/contacts/${card.contact.id}`} className="text-app-primary hover:underline">Open contact</Link></> : undefined}>
      {!card ? <LoadingState /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Mini label="Points" value={card.wallet.balance.toLocaleString("en-IN")} hint={card.wallet.pending ? `+${card.wallet.pending} pending` : card.wallet.expiringSoon ? `${card.wallet.expiringSoon} expire soon` : undefined} />
            <Mini label="Tier" value={card.wallet.tier || "—"} hint={card.wallet.next ? `${card.wallet.next.pointsToGo} pts to ${card.wallet.next.name}` : undefined} />
            <Mini label="Lifetime value" value={inr(card.lifetimeValueRupees)} hint={`${card.purchaseCount} order${card.purchaseCount === 1 ? "" : "s"} · avg ${inr(card.avgOrderRupees)}`} />
            <Mini label="Buys every" value={card.avgDaysBetween === null ? "—" : `${card.avgDaysBetween} days`} hint={card.lastPurchaseAt ? `Last: ${dateFmt.format(new Date(card.lastPurchaseAt))}` : undefined} />
          </div>
          {canWrite ? (
            <div className="flex flex-wrap items-end gap-2">
              <Button size="sm" onClick={onPurchase}><ShoppingBag className="size-4" aria-hidden="true" /> Record purchase</Button>
              <Select aria-label="Reward" value={rewardId} onChange={(e) => setRewardId(e.target.value)} className="h-9 w-auto">
                <option value="">Redeem a reward…</option>
                {rewards.map((r) => <option key={r.id} value={r.id} disabled={r.points > card.wallet.balance}>{r.name} · {r.points} pts</option>)}
              </Select>
              <Button size="sm" variant="secondary" disabled={!rewardId} loading={busy} onClick={() => void act(`${base}/redeem`, { contactId: id, rewardId }, "Reward redeemed.")}>Redeem</Button>
            </div>
          ) : null}
          {card.referral ? (
            <Card>
              <CardBody className="space-y-2">
                <p className="text-small font-semibold text-app-text">Referral link · code {card.referral.code}</p>
                <p className="break-all text-caption text-app-muted">{card.referral.link}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void copy(card.referral!.link)}><Copy className="size-4" aria-hidden="true" /> Copy link</Button>
                  <Button size="sm" variant="secondary" onClick={() => void copy(`Thank you for shopping with us! 🙏 Share this link with friends. When they buy from us, you both get reward points: ${card.referral!.link}`)}>Copy message for the customer</Button>
                </div>
                <p className="text-caption text-app-subtle">Send this to the customer. Friends who tap it open your WhatsApp with the code typed in; the reward follows their first purchase.</p>
              </CardBody>
            </Card>
          ) : null}
          {canManage ? (
            <div className="grid gap-2 sm:grid-cols-[7rem_1fr_auto] sm:items-end">
              <Field id="adj-pts" label="Adjust points">
                <Input type="number" value={adj.points} onChange={(e) => setAdj((a) => ({ ...a, points: e.target.value }))} placeholder="+50 / -20" />
              </Field>
              <Field id="adj-note" label="Reason">
                <Input value={adj.note} onChange={(e) => setAdj((a) => ({ ...a, note: e.target.value }))} maxLength={200} placeholder="Goodwill for late delivery" />
              </Field>
              <Button size="sm" variant="secondary" disabled={!Number(adj.points) || adj.note.trim().length < 3} loading={busy} onClick={() => void act(`${base}/adjust`, { contactId: id, points: Number(adj.points), note: adj.note.trim() }, "Points adjusted.")}>Apply</Button>
            </div>
          ) : null}
          <div>
            <h3 className="mb-2 text-small font-semibold text-app-text">Points history</h3>
            {!card.history.length ? <p className="text-small text-app-muted">No points yet.</p> : (
              <ul className="divide-y divide-app-border rounded-[var(--radius-control)] border border-app-border">
                {card.history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-small text-app-text">{h.note || h.kind}</span>
                      <span className="text-caption text-app-subtle">{dateFmt.format(new Date(h.createdAt))}{h.expiresAt && h.points > 0 ? ` · expires ${dateFmt.format(new Date(h.expiresAt))}` : ""}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {h.status !== "approved" ? <Badge tone={h.status === "pending" ? "warning" : "danger"}>{h.status}</Badge> : null}
                      <span className={h.points > 0 ? "font-semibold text-green-300" : "font-semibold text-app-muted"}>{h.points > 0 ? "+" : ""}{h.points}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {card.referrals.length ? (
            <div>
              <h3 className="mb-2 text-small font-semibold text-app-text">Friends referred</h3>
              <ul className="space-y-1 text-small">
                {card.referrals.map((r) => <li key={r.id} className="flex justify-between gap-2"><span className="text-app-text">{r.referee.name || r.referee.phone}</span><Badge tone={REF_STATUS[r.status as Referral["status"]]?.tone ?? "neutral"}>{REF_STATUS[r.status as Referral["status"]]?.label ?? r.status}</Badge></li>)}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-app-border p-3">
      <p className="text-caption text-app-muted">{label}</p>
      <p className="text-h3 font-semibold text-app-text">{value}</p>
      {hint ? <p className="text-caption text-app-subtle">{hint}</p> : null}
    </div>
  );
}

function PurchaseDialog({ orgId, base, contactId, onClose, onSaved }: { orgId: string; base: string; contactId: string | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [search, setSearch] = React.useState("");
  const [options, setOptions] = React.useState<{ value: string; label: string; description?: string }[]>([]);
  const [f, setF] = React.useState({ contactId: contactId ?? "", amount: "", note: "" });
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (contactId) return;
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ items: { id: string; name: string; phone: string }[] }>(`/api/organizations/${orgId}/contacts?pageSize=20${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}`);
      if (r.ok) setOptions(r.data.items.map((c) => ({ value: c.id, label: c.name || c.phone, description: c.phone })));
    }, 250);
    return () => clearTimeout(t);
  }, [orgId, search, contactId]);
  async function save() {
    setSaving(true);
    const r = await apiFetch<{ points: number; referral: string | null }>(`${base}/purchases`, { method: "POST", body: { contactId: f.contactId, amountRupees: Number(f.amount), note: f.note } });
    setSaving(false);
    if (!r.ok) return toast(r.error, "error");
    toast(`Saved. +${r.data.points} points${r.data.referral === "rewarded" ? " · referral reward paid" : r.data.referral === "waiting_approval" ? " · referral waiting for your approval" : ""}.`);
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Record a purchase" description="Points are added straight away. A referred customer's first qualifying purchase also rewards whoever referred them." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} loading={saving} disabled={!f.contactId || !(Number(f.amount) > 0)}>Save purchase</Button></>}>
      <div className="space-y-4">
        {!contactId ? (
          <div>
            <label htmlFor="p-contact" className="mb-1.5 block text-small font-medium text-app-text">Customer</label>
            <div onInput={(e) => setSearch((e.target as HTMLInputElement).value)}>
              <Combobox id="p-contact" options={options} value={f.contactId || null} onValueChange={(v) => setF((x) => ({ ...x, contactId: v }))} placeholder="Search name or phone" emptyText="Not found. Add them in Contacts first." />
            </div>
          </div>
        ) : null}
        <Field id="p-amount" label="Amount (₹)">
          <Input type="number" min={1} inputMode="decimal" value={f.amount} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} autoFocus={Boolean(contactId)} />
        </Field>
        <Field id="p-note" label="Note (optional)" hint="Bill number or what they bought">
          <Input value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} maxLength={200} />
        </Field>
      </div>
    </Modal>
  );
}

function ReferralsTab({ base, canManage, tick, onChanged }: { base: string; canManage: boolean; tick: number; onChanged: () => void }) {
  const toast = useToast();
  const [status, setStatus] = React.useState("");
  const [rows, setRows] = React.useState<Referral[] | null>(null);
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ referrals: Referral[] }>(`${base}/referrals${status ? `?status=${status}` : ""}`);
      if (r.ok) setRows(r.data.referrals);
    }, 0);
    return () => clearTimeout(t);
  }, [base, status, tick, n]);
  async function decide(id: string, decision: "approve" | "reject") {
    const r = await apiFetch(`${base}/referrals/${id}`, { method: "POST", body: { decision } });
    if (!r.ok) return toast(r.error, "error");
    toast(decision === "approve" ? "Approved: points added." : "Rejected.");
    setN((x) => x + 1);
    onChanged();
  }
  return (
    <Card>
      <CardBody className="space-y-3">
        <FilterBar>
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-full sm:w-64">
            <option value="">All referrals</option>
            <option value="qualified">Needs your approval</option>
            <option value="pending">Waiting for first purchase</option>
            <option value="rewarded">Rewarded</option>
            <option value="rejected">Rejected</option>
          </Select>
        </FilterBar>
        {!rows ? <LoadingState /> : !rows.length ? (
          <EmptyState icon={UserPlus} title="No referrals yet" description="Open a customer in the Customers tab to copy their referral link and send it to them." />
        ) : (
          <ul className="divide-y divide-app-border">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-small text-app-text"><span className="font-semibold">{r.referrer.name || r.referrer.phone}</span> referred <span className="font-semibold">{r.referee.name || r.referee.phone}</span></p>
                  <p className="text-caption text-app-subtle">Code {r.code} · {dateFmt.format(new Date(r.createdAt))}</p>
                  {r.flag ? <p className="mt-1 flex items-center gap-1 text-caption text-amber-300"><AlertTriangle className="size-3.5" aria-hidden="true" /> {r.flag}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={REF_STATUS[r.status].tone}>{REF_STATUS[r.status].label}</Badge>
                  {canManage && (r.status === "pending" || r.status === "qualified") ? (
                    <>
                      <Button size="sm" onClick={() => void decide(r.id, "approve")}>Approve</Button>
                      <Button size="sm" variant="secondary" onClick={() => void decide(r.id, "reject")}>Reject</Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function RewardsTab({ base, canManage }: { base: string; canManage: boolean }) {
  const toast = useToast();
  const [rows, setRows] = React.useState<Reward[] | null>(null);
  const [edit, setEdit] = React.useState<Partial<Reward> | null>(null);
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ rewards: Reward[] }>(`${base}/rewards`);
      if (r.ok) setRows(r.data.rewards);
    }, 0);
    return () => clearTimeout(t);
  }, [base, n]);
  async function save() {
    if (!edit) return;
    const body = { name: edit.name ?? "", description: edit.description ?? "", points: Number(edit.points), active: edit.active ?? true };
    const r = await apiFetch(edit.id ? `${base}/rewards/${edit.id}` : `${base}/rewards`, { method: edit.id ? "PATCH" : "POST", body });
    if (!r.ok) return toast(r.error, "error");
    toast("Reward saved.");
    setEdit(null);
    setN((x) => x + 1);
  }
  return (
    <Card>
      <CardHeader title="Rewards catalogue" description="What customers can get with their points." action={canManage ? <Button size="sm" onClick={() => setEdit({ active: true })}><Plus className="size-4" aria-hidden="true" /> Add reward</Button> : undefined} />
      <CardBody>
        {!rows ? <LoadingState /> : !rows.length ? (
          <EmptyState icon={Gift} title="No rewards yet" description="Add a few, e.g. “Free hair wash – 200 points” or “₹100 off – 500 points”." />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-2 rounded-[var(--radius-control)] border border-app-border p-3">
                <span>
                  <span className="block text-small font-semibold text-app-text">{r.name}</span>
                  <span className="block text-caption text-app-muted">{r.points.toLocaleString("en-IN")} points{r.description ? ` · ${r.description}` : ""}</span>
                </span>
                <span className="flex items-center gap-2">
                  {!r.active ? <Badge>Off</Badge> : null}
                  {canManage ? <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      {edit ? (
        <Modal open onClose={() => setEdit(null)} title={edit.id ? "Edit reward" : "New reward"} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => void save()} disabled={!edit.name?.trim() || !(Number(edit.points) > 0)}>Save</Button></>}>
          <div className="space-y-4">
            <Field id="rw-name" label="Reward"><Input value={edit.name ?? ""} onChange={(e) => setEdit((x) => ({ ...x, name: e.target.value }))} maxLength={80} /></Field>
            <Field id="rw-points" label="Points needed"><Input type="number" min={1} value={edit.points ?? ""} onChange={(e) => setEdit((x) => ({ ...x, points: Number(e.target.value) }))} /></Field>
            <Field id="rw-desc" label="Details (optional)"><Input value={edit.description ?? ""} onChange={(e) => setEdit((x) => ({ ...x, description: e.target.value }))} maxLength={300} /></Field>
            <Switch checked={edit.active ?? true} onCheckedChange={(v) => setEdit((x) => ({ ...x, active: v }))} label="Available to redeem" />
          </div>
        </Modal>
      ) : null}
    </Card>
  );
}

function SettingsTab({ base, onSaved }: { base: string; onSaved: () => void }) {
  const toast = useToast();
  const [s, setS] = React.useState<LoyaltySettings | null>(null);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    const t = window.setTimeout(async () => {
      const r = await apiFetch<{ settings: LoyaltySettings }>(`${base}/settings`);
      setS(r.ok ? r.data.settings : DEFAULT_LOYALTY);
    }, 0);
    return () => clearTimeout(t);
  }, [base]);
  if (!s) return <LoadingState />;
  const num = (k: keyof LoyaltySettings) => (e: React.ChangeEvent<HTMLInputElement>) => setS((x) => x && { ...x, [k]: Number(e.target.value) });
  async function save() {
    setSaving(true);
    const r = await apiFetch(`${base}/settings`, { method: "PUT", body: s });
    setSaving(false);
    if (!r.ok) return toast(r.error, "error");
    toast("Loyalty settings saved.");
    onSaved();
  }
  return (
    <Card>
      <CardHeader title="Programme rules" action={<Button size="sm" onClick={() => void save()} loading={saving}>Save</Button>} />
      <CardBody className="space-y-5">
        <Switch checked={s.enabled} onCheckedChange={(v) => setS((x) => x && { ...x, enabled: v })} label="Loyalty programme is on" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="ls-earn" label="Points per ₹100 spent"><Input type="number" min={0} step="0.5" value={s.pointsPer100} onChange={num("pointsPer100")} /></Field>
          <Field id="ls-welcome" label="Welcome points (first purchase)"><Input type="number" min={0} value={s.welcomePoints} onChange={num("welcomePoints")} /></Field>
          <Field id="ls-exp" label="Points expire after (days)" hint="0 = never"><Input type="number" min={0} value={s.expiryDays} onChange={num("expiryDays")} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field id="ls-rr" label="Referrer gets (points)"><Input type="number" min={0} value={s.referrerPoints} onChange={num("referrerPoints")} /></Field>
          <Field id="ls-re" label="New friend gets (points)"><Input type="number" min={0} value={s.refereePoints} onChange={num("refereePoints")} /></Field>
          <Field id="ls-min" label="Friend's first purchase at least (₹)"><Input type="number" min={0} value={s.referralMinPurchaseRupees} onChange={num("referralMinPurchaseRupees")} /></Field>
          <Field id="ls-appr" label="Referral rewards">
            <Select value={s.referralApproval} onChange={(e) => setS((x) => x && { ...x, referralApproval: e.target.value as "auto" | "manual" })}>
              <option value="manual">I approve each one</option>
              <option value="auto">Pay automatically (flagged ones still wait)</option>
            </Select>
          </Field>
        </div>
        <div>
          <p className="mb-2 text-small font-medium text-app-text">Membership tiers (by lifetime points)</p>
          <div className="space-y-2">
            {s.tiers.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_auto] gap-2">
                <Input aria-label="Tier name" value={t.name} onChange={(e) => setS((x) => x && { ...x, tiers: x.tiers.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} maxLength={30} />
                <Input aria-label="From points" type="number" min={0} value={t.minPoints} onChange={(e) => setS((x) => x && { ...x, tiers: x.tiers.map((y, j) => (j === i ? { ...y, minPoints: Number(e.target.value) } : y)) })} />
                <Button size="sm" variant="ghost" onClick={() => setS((x) => x && { ...x, tiers: x.tiers.filter((_, j) => j !== i) })}>Remove</Button>
              </div>
            ))}
            {s.tiers.length < 6 ? <Button size="sm" variant="secondary" onClick={() => setS((x) => x && { ...x, tiers: [...x.tiers, { name: "New tier", minPoints: (x.tiers.at(-1)?.minPoints ?? 0) + 1000 }] })}><Plus className="size-4" aria-hidden="true" /> Add tier</Button> : null}
          </div>
        </div>
        <Alert tone="info">Points are a reward, not money: show customers what they can get in the Rewards tab. Referral rewards follow a real purchase, so people can&apos;t earn by just sending messages.</Alert>
      </CardBody>
    </Card>
  );
}
