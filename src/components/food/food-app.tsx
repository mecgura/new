"use client";

import * as React from "react";
import Link from "next/link";
import { BarChart3, ChefHat, Download, Pencil, Plus, QrCode, Settings2, Trash2, UtensilsCrossed, Volume2, VolumeX } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, IconButton, Input, LoadingState, Modal, PageHeader, Select, StatCard, Table, TBody, TD, TH, THead, TR, Textarea, type BadgeTone, useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type Line = { itemId: string; name: string; qty: number; pricePaise: number };
type Order = { id: string; number: number; spotLabel: string; guestName: string; items: Line[]; note: string; totalPaise: number; status: string; paymentMode: string; paymentStatus: string; placedAt: string | null; next: string[]; conversationId: string | null };
type Item = { id: string; category: string; name: string; description: string; pricePaise: number; imageUrl: string; veg: boolean; available: boolean; sortOrder: number };
type Spot = { id: string; label: string; code: string; kind: string; active: boolean; url: string };

const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  placed: { label: "New", tone: "danger" },
  accepted: { label: "Accepted", tone: "warning" },
  preparing: { label: "Preparing", tone: "warning" },
  ready: { label: "Ready", tone: "success" },
  delivered: { label: "Delivered", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
const ACTION: Record<string, string> = { accepted: "Accept", preparing: "Preparing", ready: "Ready", delivered: "Delivered", cancelled: "Cancel" };
const PAY: Record<string, string> = { pay_now: "Pay now", room_bill: "Room bill", counter: "Counter" };
const TABS = [
  { id: "kitchen", label: "Kitchen", icon: ChefHat },
  { id: "menu", label: "Menu", icon: UtensilsCrossed },
  { id: "spots", label: "Rooms & tables", icon: QrCode, manage: true },
  { id: "settings", label: "Settings", icon: Settings2, manage: true },
  { id: "report", label: "Report", icon: BarChart3, manage: true },
];

/** Food ordering: kitchen screen, menu, rooms/tables with QR codes, settings and report. */
export function FoodApp({ orgId, canManage, initialTab }: { orgId: string; canManage: boolean; initialTab: string }) {
  const base = `/api/organizations/${orgId}/food`;
  const [tab, setTab] = React.useState(initialTab);
  return (
    <>
      <PageHeader title="Food orders" description="Guests scan the QR on their room or table, choose from the menu and confirm on WhatsApp. Every update reaches them on WhatsApp." />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-app-border" role="tablist">
        {TABS.filter((t) => canManage || !t.manage).map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-small", tab === t.id ? "border-app-primary text-app-text" : "border-transparent text-app-muted hover:text-app-text")}>
            <t.icon className="size-4" aria-hidden="true" /> {t.label}
          </button>
        ))}
      </div>
      {tab === "kitchen" ? <Kitchen base={base} /> : null}
      {tab === "menu" ? <MenuTab base={base} canManage={canManage} /> : null}
      {tab === "spots" && canManage ? <SpotsTab base={base} /> : null}
      {tab === "settings" && canManage ? <SettingsTab base={base} /> : null}
      {tab === "report" && canManage ? <ReportTab base={base} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Kitchen
// ---------------------------------------------------------------------------

function beep() {
  try {
    const ctx = new AudioContext();
    for (const [i, f] of [880, 1175, 880].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.17);
    }
  } catch {
    /* audio blocked until the user interacts */
  }
}

function Kitchen({ base }: { base: string }) {
  const toast = useToast();
  const [orders, setOrders] = React.useState<Order[] | null>(null);
  const [view, setView] = React.useState<"active" | "today">("active");
  const [sound, setSound] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const seen = React.useRef<Set<string> | null>(null);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ orders: Order[] }>(`${base}/orders?view=${view}`);
    if (!r.ok) return;
    const fresh = r.data.orders.filter((o) => o.status === "placed").map((o) => o.id);
    if (seen.current && sound && fresh.some((id) => !seen.current!.has(id))) beep();
    seen.current = new Set([...(seen.current ?? []), ...fresh]);
    setOrders(r.data.orders);
  }, [base, view, sound]);
  React.useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const t = window.setInterval(() => void load(), 5000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [load]);

  async function move(o: Order, to: string) {
    const reason = to === "cancelled" ? window.prompt("Why is it cancelled? (the guest sees this)") : "";
    if (to === "cancelled" && reason === null) return;
    setBusy(o.id + to);
    const r = await apiFetch<{ guestUpdate: string }>(`${base}/orders/${o.id}`, { method: "POST", body: { to, reason: reason ?? "" } });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    if (r.data.guestUpdate !== "sent") toast(`Updated. The guest wasn't messaged (${r.data.guestUpdate.replace("not_sent: ", "")}).`, "error");
    void load();
  }
  async function paid(o: Order) {
    setBusy(o.id + "paid");
    const r = await apiFetch(`${base}/orders/${o.id}/paid`, { method: "POST", body: {} });
    setBusy("");
    if (!r.ok) return toast(r.error, "error");
    void load();
  }

  if (!orders) return <LoadingState />;
  const cols = view === "active" ? [{ key: "new", title: "New", match: ["placed"] }, { key: "kitchen", title: "In the kitchen", match: ["accepted", "preparing"] }, { key: "ready", title: "Ready to serve", match: ["ready"] }] : null;
  const card = (o: Order) => (
    <Card key={o.id} className={cn(o.status === "placed" && "border-red-500/50 shadow-[0_0_0_1px_rgba(239,68,68,0.35)]")}>
      <CardBody className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-h4 font-bold text-app-text">#{o.number} · {o.spotLabel}</p>
            <p className="text-caption text-app-subtle">{o.guestName || "Guest"} · {o.placedAt ? new Date(o.placedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : ""}</p>
          </div>
          <Badge tone={STATUS[o.status]?.tone ?? "neutral"} dot>{STATUS[o.status]?.label ?? o.status}</Badge>
        </div>
        <ul className="space-y-0.5 text-body text-app-text">
          {o.items.map((l) => <li key={l.itemId}><strong>{l.qty}×</strong> {l.name}</li>)}
        </ul>
        {o.note ? <p className="rounded-md bg-amber-500/10 px-2 py-1 text-small text-amber-300">Note: {o.note}</p> : null}
        <p className="flex flex-wrap items-center gap-2 text-small text-app-muted">
          {inr(o.totalPaise)} · {PAY[o.paymentMode] ?? o.paymentMode}
          <Badge tone={o.paymentStatus === "paid" ? "success" : "warning"}>{o.paymentStatus === "paid" ? "Paid" : o.paymentMode === "pay_now" ? "Awaiting payment" : "Unpaid"}</Badge>
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {o.next.filter((s) => s !== "cancelled").map((s) => <Button key={s} size="sm" onClick={() => void move(o, s)} loading={busy === o.id + s}>{ACTION[s]}</Button>)}
          {o.paymentStatus !== "paid" && o.status !== "cancelled" ? <Button size="sm" variant="secondary" onClick={() => void paid(o)} loading={busy === o.id + "paid"}>Mark paid</Button> : null}
          {o.next.includes("cancelled") ? <Button size="sm" variant="ghost" onClick={() => void move(o, "cancelled")}>Cancel</Button> : null}
          {o.conversationId ? <Link href={`/inbox?c=${o.conversationId}`} className="self-center text-caption text-app-primary hover:underline">Chat</Link> : null}
        </div>
      </CardBody>
    </Card>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-full border border-app-border p-1" role="group" aria-label="Show">
          {(["active", "today"] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("rounded-full px-3 py-1 text-small", view === v ? "bg-app-primary text-app-on-primary" : "text-app-muted")}>{v === "active" ? "Live orders" : "Last 24 hours"}</button>)}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setSound(!sound)}>{sound ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />} Sound {sound ? "on" : "off"}</Button>
      </div>
      {!orders.length ? (
        <Card><EmptyState icon={ChefHat} title={view === "active" ? "No live orders" : "No orders in the last 24 hours"} description="New orders appear here within a few seconds, with a sound. Keep this screen open in the kitchen." /></Card>
      ) : cols ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {cols.map((c) => {
            const list = orders.filter((o) => c.match.includes(o.status));
            return (
              <section key={c.key} aria-label={c.title} className="space-y-3">
                <p className="text-small font-semibold text-app-muted">{c.title} · {list.length}</p>
                {list.map(card)}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{orders.map(card)}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

const EMPTY_ITEM = { category: "", name: "", description: "", priceRupees: "", imageUrl: "", veg: true, available: true, sortOrder: "0" };

function MenuTab({ base, canManage }: { base: string; canManage: boolean }) {
  const toast = useToast();
  const [items, setItems] = React.useState<Item[] | null>(null);
  const [edit, setEdit] = React.useState<(typeof EMPTY_ITEM & { id?: string }) | null>(null);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ items: Item[] }>(`${base}/menu`);
    if (r.ok) setItems(r.data.items);
  }, [base]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    const body = { category: edit.category || "Menu", name: edit.name, description: edit.description, priceRupees: Number(edit.priceRupees), imageUrl: edit.imageUrl, veg: edit.veg, available: edit.available, sortOrder: Number(edit.sortOrder) || 0 };
    const r = await apiFetch(edit.id ? `${base}/menu/${edit.id}` : `${base}/menu`, { method: edit.id ? "PUT" : "POST", body });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setEdit(null);
    void load();
  }
  async function toggle(i: Item) {
    const r = await apiFetch(`${base}/menu/${i.id}`, { method: "PATCH", body: { available: !i.available } });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }
  async function remove(i: Item) {
    if (!window.confirm(`Delete “${i.name}”?`)) return;
    const r = await apiFetch(`${base}/menu/${i.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }

  if (!items) return <LoadingState />;
  const cats = [...new Set(items.map((i) => i.category))];
  return (
    <div className="space-y-4">
      {canManage ? <div className="flex justify-end"><Button onClick={() => setEdit({ ...EMPTY_ITEM, category: cats[0] ?? "" })}><Plus aria-hidden="true" /> Add dish</Button></div> : null}
      {!items.length ? <Card><EmptyState icon={UtensilsCrossed} title="No dishes yet" description="Add your menu: category, name, price and an optional photo." /></Card> : null}
      {cats.map((c) => (
        <Card key={c}>
          <CardHeader title={c} description={`${items.filter((i) => i.category === c).length} item(s)`} />
          <ul className="divide-y divide-app-border">
            {items.filter((i) => i.category === c).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className={`size-2.5 rounded-full ${i.veg ? "bg-green-500" : "bg-red-500"}`} aria-label={i.veg ? "Veg" : "Non-veg"} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-small font-medium", i.available ? "text-app-text" : "text-app-subtle line-through")}>{i.name}</span>
                  {i.description ? <span className="block truncate text-caption text-app-subtle">{i.description}</span> : null}
                </span>
                <span className="text-small tabular-nums text-app-text">{inr(i.pricePaise)}</span>
                <Button size="sm" variant={i.available ? "secondary" : "primary"} onClick={() => void toggle(i)}>{i.available ? "Mark sold out" : "Back in stock"}</Button>
                {canManage ? (
                  <>
                    <IconButton label={`Edit ${i.name}`} onClick={() => setEdit({ id: i.id, category: i.category, name: i.name, description: i.description, priceRupees: String(i.pricePaise / 100), imageUrl: i.imageUrl, veg: i.veg, available: i.available, sortOrder: String(i.sortOrder) })}><Pencil aria-hidden="true" /></IconButton>
                    <IconButton label={`Delete ${i.name}`} onClick={() => void remove(i)}><Trash2 aria-hidden="true" /></IconButton>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit dish" : "Add dish"}>
        {edit ? (
          <form onSubmit={save} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="mi-cat" label="Category" hint="e.g. Starters, Main course, Drinks"><Input value={edit.category} maxLength={40} list="mi-cats" onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></Field>
              <Field id="mi-price" label="Price (₹)"><Input type="number" min={0} step="0.5" value={edit.priceRupees} onChange={(e) => setEdit({ ...edit, priceRupees: e.target.value })} /></Field>
            </div>
            <datalist id="mi-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
            <Field id="mi-name" label="Dish name"><Input value={edit.name} maxLength={80} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field id="mi-desc" label="Short description (optional)"><Textarea rows={2} maxLength={200} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field id="mi-img" label="Photo link (optional)" hint="https://… image link"><Input value={edit.imageUrl} maxLength={500} onChange={(e) => setEdit({ ...edit, imageUrl: e.target.value })} /></Field>
            <div className="flex flex-wrap gap-4">
              <Checkbox id="mi-veg" label="Vegetarian" checked={edit.veg} onChange={(e) => setEdit({ ...edit, veg: e.target.checked })} />
              <Checkbox id="mi-av" label="Available" checked={edit.available} onChange={(e) => setEdit({ ...edit, available: e.target.checked })} />
            </div>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit" loading={busy} disabled={!edit.name.trim() || edit.priceRupees === ""}>Save</Button></div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rooms & tables
// ---------------------------------------------------------------------------

function SpotsTab({ base }: { base: string }) {
  const toast = useToast();
  const [spots, setSpots] = React.useState<Spot[] | null>(null);
  const [f, setF] = React.useState({ kind: "room", prefix: "Room", from: "101", to: "110" });
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    const r = await apiFetch<{ spots: Spot[] }>(`${base}/spots`);
    if (r.ok) setSpots(r.data.spots);
  }, [base]);
  React.useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const range = f.from !== "" && f.to !== "";
    const r = await apiFetch<{ added: number }>(`${base}/spots`, { method: "POST", body: { kind: f.kind, prefix: f.prefix, ...(range ? { from: Number(f.from), to: Number(f.to) } : {}) } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    toast(`${r.data.added} added`);
    void load();
  }
  async function remove(s: Spot) {
    if (!window.confirm(`Delete ${s.label}? Its QR code stops working.`)) return;
    const r = await apiFetch(`${base}/spots/${s.id}`, { method: "DELETE" });
    if (!r.ok) return toast(r.error, "error");
    void load();
  }
  if (!spots) return <LoadingState />;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Add rooms or tables" description="Each gets its own QR code. Use a range (Room 101–120) or leave the numbers empty for one spot (e.g. “Pool side”)." />
        <CardBody>
          <form onSubmit={add} className="grid items-end gap-3 sm:grid-cols-5">
            <Field id="sp-kind" label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, prefix: e.target.value === "room" ? "Room" : e.target.value === "table" ? "Table" : f.prefix })}><option value="room">Room</option><option value="table">Table</option><option value="other">Other</option></Select></Field>
            <Field id="sp-prefix" label="Name"><Input value={f.prefix} maxLength={30} onChange={(e) => setF({ ...f, prefix: e.target.value })} /></Field>
            <Field id="sp-from" label="From"><Input type="number" min={0} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
            <Field id="sp-to" label="To"><Input type="number" min={0} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
            <Button type="submit" loading={busy}><Plus aria-hidden="true" /> Add</Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={`QR codes · ${spots.length}`} action={spots.length ? <Link href="/food/qr" className="text-small text-app-primary hover:underline">Print all QR codes →</Link> : null} />
        {!spots.length ? <EmptyState icon={QrCode} title="No rooms or tables yet" className="py-8" /> : (
          <Table>
            <THead><TR><TH>Room / table</TH><TH>Menu link</TH><TH /></TR></THead>
            <TBody>
              {spots.map((s) => (
                <TR key={s.id}>
                  <TD className="font-medium">{s.label}</TD>
                  <TD><a href={s.url} target="_blank" rel="noopener noreferrer" className="break-all text-caption text-app-primary hover:underline">{s.url.replace(/^https?:\/\//, "")}</a></TD>
                  <TD className="text-right">
                    <a href={`${base}/spots/${s.id}/qr`} className="mr-2 inline-flex items-center gap-1 text-small text-app-muted hover:text-app-text"><Download className="size-4" aria-hidden="true" /> QR</a>
                    <IconButton label={`Delete ${s.label}`} onClick={() => void remove(s)}><Trash2 aria-hidden="true" /></IconButton>
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

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

type Settings = { whatsappAccountId: string | null; venueName: string; paymentModes: string[]; taxPercent: number; welcomeNote: string; acceptingOrders: boolean; razorpayKeyId: string; hasKeySecret: boolean; hasWebhookSecret: boolean; webhookUrl: string };

function SettingsTab({ base }: { base: string }) {
  const toast = useToast();
  const [data, setData] = React.useState<{ settings: Settings; numbers: { id: string; displayName: string; phoneNumber: string; isDemo: boolean }[] } | null>(null);
  const [f, setF] = React.useState<Settings | null>(null);
  const [secret, setSecret] = React.useState("");
  const [hook, setHook] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    void apiFetch<{ settings: Settings; numbers: { id: string; displayName: string; phoneNumber: string; isDemo: boolean }[] }>(`${base}/settings`).then((r) => {
      if (r.ok) {
        setData(r.data);
        setF(r.data.settings);
      }
    });
  }, [base]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f) return;
    setBusy(true);
    const r = await apiFetch<{ settings: Settings }>(`${base}/settings`, { method: "PUT", body: { whatsappAccountId: f.whatsappAccountId || null, venueName: f.venueName, paymentModes: f.paymentModes, taxPercent: Number(f.taxPercent) || 0, welcomeNote: f.welcomeNote, acceptingOrders: f.acceptingOrders, razorpayKeyId: f.razorpayKeyId, ...(secret ? { razorpayKeySecret: secret } : {}), ...(hook ? { webhookSecret: hook } : {}) } });
    setBusy(false);
    if (!r.ok) return toast(r.error, "error");
    setF(r.data.settings);
    setSecret("");
    setHook("");
    toast("Saved");
  }
  if (!data || !f) return <LoadingState />;
  const mode = (m: string, on: boolean) => setF({ ...f, paymentModes: on ? [...new Set([...f.paymentModes, m])] : f.paymentModes.filter((x) => x !== m) });
  return (
    <form onSubmit={save} className="space-y-4">
      <Card>
        <CardHeader title="Ordering" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field id="fs-num" label="WhatsApp number guests confirm on" hint="Orders and updates use this number.">
            <Select value={f.whatsappAccountId ?? ""} onChange={(e) => setF({ ...f, whatsappAccountId: e.target.value || null })}>
              <option value="">Choose…</option>
              {data.numbers.map((n) => <option key={n.id} value={n.id}>{n.displayName} · {n.phoneNumber}{n.isDemo ? " (demo)" : ""}</option>)}
            </Select>
          </Field>
          <Field id="fs-venue" label="Name on the menu"><Input value={f.venueName} maxLength={80} onChange={(e) => setF({ ...f, venueName: e.target.value })} placeholder="e.g. Hill View Resort – In-room dining" /></Field>
          <Field id="fs-tax" label="Tax (%)" hint="Added to the order total (0 if prices include tax)."><Input type="number" min={0} max={28} step="0.5" value={String(f.taxPercent)} onChange={(e) => setF({ ...f, taxPercent: Number(e.target.value) })} /></Field>
          <div className="flex items-end"><Checkbox id="fs-open" label="Taking orders now" description="Untick to pause ordering (the menu still shows)." checked={f.acceptingOrders} onChange={(e) => setF({ ...f, acceptingOrders: e.target.checked })} /></div>
          <Field id="fs-note" label="Note on the menu (optional)" className="sm:col-span-2"><Textarea rows={2} maxLength={300} value={f.welcomeNote} onChange={(e) => setF({ ...f, welcomeNote: e.target.value })} placeholder="Kitchen open 7 am – 11 pm. Delivery in 20–30 minutes." /></Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Payment options" description="Guests choose one when ordering. “Room bill” only shows for rooms." />
        <CardBody className="space-y-3">
          <Checkbox id="pm-room" label="Add to room bill" checked={f.paymentModes.includes("room_bill")} onChange={(e) => mode("room_bill", e.target.checked)} />
          <Checkbox id="pm-counter" label="Pay at the counter / when served" checked={f.paymentModes.includes("counter")} onChange={(e) => mode("counter", e.target.checked)} />
          <Checkbox id="pm-now" label="Pay now (UPI / card through your Razorpay)" checked={f.paymentModes.includes("pay_now")} onChange={(e) => mode("pay_now", e.target.checked)} />
          {f.paymentModes.includes("pay_now") ? (
            <div className="grid gap-3 rounded-xl border border-app-border p-3 sm:grid-cols-2">
              <Alert tone="info" className="sm:col-span-2">The money goes straight to <strong>your own Razorpay account</strong>. In Razorpay: Settings → API Keys (key id + secret), and Settings → Webhooks → add the URL below with event <code>payment_link.paid</code> and a secret.</Alert>
              <Field id="rz-id" label="Razorpay key id"><Input value={f.razorpayKeyId} maxLength={60} onChange={(e) => setF({ ...f, razorpayKeyId: e.target.value.trim() })} placeholder="rzp_live_…" /></Field>
              <Field id="rz-secret" label="Key secret" hint={f.hasKeySecret ? "Saved — leave empty to keep it." : "Stored encrypted, never shown again."}><Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></Field>
              <Field id="rz-hook" label="Webhook URL"><Input value={f.webhookUrl} readOnly onFocus={(e) => e.currentTarget.select()} /></Field>
              <Field id="rz-hsecret" label="Webhook secret" hint={f.hasWebhookSecret ? "Saved — leave empty to keep it." : "The same secret you type in Razorpay."}><Input type="password" value={hook} onChange={(e) => setHook(e.target.value)} autoComplete="off" /></Field>
            </div>
          ) : null}
        </CardBody>
      </Card>
      <div className="flex justify-end"><Button type="submit" loading={busy}>Save settings</Button></div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

type Report = { days: number; orders: number; cancelled: number; revenuePaise: number; paidPaise: number; unpaidPaise: number; avgPrepMinutes: number | null; topItems: { name: string; qty: number; revenuePaise: number }[]; bySpot: { spot: string; revenuePaise: number }[]; byPayment: { mode: string; orders: number }[] };

function ReportTab({ base }: { base: string }) {
  const [days, setDays] = React.useState(7);
  const [r, setR] = React.useState<Report | null>(null);
  React.useEffect(() => {
    void apiFetch<Report>(`${base}/report?days=${days}`).then((x) => x.ok && setR(x.data));
  }, [base, days]);
  if (!r) return <LoadingState />;
  const max = Math.max(1, ...r.topItems.map((t) => t.qty));
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-full border border-app-border p-1 w-fit" role="group" aria-label="Period">
        {[1, 7, 30].map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={cn("rounded-full px-3 py-1 text-small", days === d ? "bg-app-primary text-app-on-primary" : "text-app-muted")}>{d === 1 ? "Today" : `${d} days`}</button>)}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Orders" value={String(r.orders)} icon={ChefHat} hint={`${r.cancelled} cancelled`} />
        <StatCard label="Sales" value={inr(r.revenuePaise)} icon={BarChart3} hint={`${inr(r.paidPaise)} paid`} />
        <StatCard label="To collect" value={inr(r.unpaidPaise)} icon={UtensilsCrossed} hint="Room bill / counter / awaiting" />
        <StatCard label="Avg. time to ready" value={r.avgPrepMinutes === null ? "—" : `${r.avgPrepMinutes} min`} icon={ChefHat} hint="Order placed → ready" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top dishes" />
          <CardBody className="space-y-2">
            {!r.topItems.length ? <p className="text-small text-app-muted">No orders yet.</p> : r.topItems.map((t) => (
              <div key={t.name}>
                <p className="flex justify-between text-small"><span className="text-app-text">{t.name}</span><span className="tabular-nums text-app-muted">{t.qty} · {inr(t.revenuePaise)}</span></p>
                <span className="mt-1 block h-2 rounded-full bg-app-border"><span className="block h-2 rounded-full bg-emerald-500" style={{ width: `${(t.qty / max) * 100}%` }} /></span>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Sales by room / table" />
          {!r.bySpot.length ? <CardBody><p className="text-small text-app-muted">No orders yet.</p></CardBody> : (
            <Table><THead><TR><TH>Room / table</TH><TH className="text-right">Sales</TH></TR></THead><TBody>{r.bySpot.map((s) => <TR key={s.spot}><TD>{s.spot}</TD><TD className="text-right tabular-nums">{inr(s.revenuePaise)}</TD></TR>)}</TBody></Table>
          )}
        </Card>
      </div>
    </div>
  );
}
