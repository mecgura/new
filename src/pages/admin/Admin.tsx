import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Building2, Users, Smartphone, IndianRupee, Send, Inbox, Plus } from 'lucide-react'
import { post, patch, put, store } from '../../lib/api'
import { useApi, useDebounced } from '../../lib/hooks'
import { useSession } from '../../lib/session'
import { date, dateTime, inr, num, titleCase } from '../../lib/format'
import Logo from '../../components/Logo'
import { Badge, Button, Card, Drawer, Field, Input, Loading, Modal, Select, Stat, Table, Tabs, Td, Textarea, useToast, statusTone } from '../../components/ui'
import type { Plan, Usage } from '../../lib/types'

type WsRow = { id: number; name: string; status: string; subscription_status: string; plan: string; plan_id: number; owner_email: string; contacts: number; numbers: number; messages_month: number; current_period_end: string | null; created_at: string }
type WsDetail = WsRow & { usage: Usage; members: { id: number; name: string; email: string; role: string; last_login_at: string | null }[]; invoices: { id: number; amount: number; cycle: string; status: string; created_at: string }[] }

function Client({ id, plans, onClose, onChanged }: { id: number; plans: Plan[]; onClose: () => void; onChanged: () => void }) {
  const t = useToast()
  const { data, reload } = useApi<WsDetail>(`/api/admin/workspaces/${id}`)
  const [pay, setPay] = useState({ plan_id: 0, cycle: 'monthly', amount: 0, reference: '' })
  const [reset, setReset] = useState<{ email: string; password: string } | null>(null)
  const act = async (body: Record<string, unknown>) => { try { await patch(`/api/admin/workspaces/${id}`, body); t.ok('Updated'); void reload(); onChanged() } catch (e) { t.err(e) } }
  return (
    <Drawer open onClose={onClose} title={data?.name ?? 'Client'}>
      {!data ? <Loading /> : <div className="space-y-5">
        <div className="flex flex-wrap gap-2"><Badge tone={statusTone(data.status)}>{data.status}</Badge><Badge tone={statusTone(data.subscription_status)}>{data.subscription_status}</Badge><Badge>until {date(data.current_period_end)}</Badge></div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Plan"><Select value={data.plan_id} onChange={(e) => act({ plan_id: Number(e.target.value) })}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Subscription"><Select value={data.subscription_status} onChange={(e) => act({ subscription_status: e.target.value })}>{['trialing', 'active', 'past_due', 'expired', 'cancelled'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.status === 'active' ? <Button size="sm" variant="danger" onClick={() => act({ status: 'suspended' })}>Suspend workspace</Button> : <Button size="sm" onClick={() => act({ status: 'active' })}>Re-activate</Button>}
          <Button size="sm" variant="subtle" onClick={() => act({ trial_days: 14 })}>Extend trial 14 days</Button>
          <Button size="sm" variant="outline" onClick={() => { store.ws = id; window.location.assign('/app') }}>Open workspace</Button>
        </div>
        <Card title="Record offline payment (UPI / bank)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plan"><Select value={pay.plan_id} onChange={(e) => { const p = plans.find((x) => x.id === Number(e.target.value)); setPay({ ...pay, plan_id: Number(e.target.value), amount: p ? (pay.cycle === 'yearly' ? p.price_yearly : p.price_monthly) : 0 }) }}><option value={0}>Select…</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Cycle"><Select value={pay.cycle} onChange={(e) => setPay({ ...pay, cycle: e.target.value })}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></Select></Field>
            <Field label="Amount (₹)"><Input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} /></Field>
            <Field label="Reference / UTR"><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></Field>
          </div>
          <Button className="mt-3" size="sm" disabled={!pay.plan_id} onClick={async () => { try { await post(`/api/admin/workspaces/${id}/invoices`, pay); t.ok('Payment recorded & plan activated'); void reload(); onChanged() } catch (e) { t.err(e) } }}>Record & activate</Button>
        </Card>
        <Card title="Usage">{Object.entries(data.usage).map(([k, u]) => <div key={k} className="flex justify-between py-1 text-sm"><span className="text-muted">{titleCase(k)}</span><span className="text-white">{num(u.used)} / {u.limit < 0 ? '∞' : num(u.limit)}</span></div>)}</Card>
        <Card title="Members" pad={false}><Table head={['Name', 'Role', 'Last login', '']}>{data.members.map((m) => <tr key={m.id}><Td><div className="text-white">{m.name}</div><div className="text-xs text-muted">{m.email}</div></Td><Td>{m.role}</Td><Td className="text-xs">{dateTime(m.last_login_at)}</Td>
          <Td className="text-right"><Button size="sm" variant="ghost" onClick={async () => { try { const r = await post<{ email: string; password: string }>(`/api/admin/users/${m.id}/reset-password`); setReset(r) } catch (e) { t.err(e) } }}>Reset password</Button></Td></tr>)}</Table></Card>
        {reset && <div className="rounded-xl border border-brand/30 bg-brand/10 p-4 text-sm"><div className="text-soft">New password for <b className="text-white">{reset.email}</b> (shown once — share it securely):</div>
          <div className="mt-2 flex gap-2"><Input readOnly value={reset.password} className="font-mono" /><Button variant="subtle" onClick={() => { void navigator.clipboard.writeText(reset.password); t.ok('Copied') }}>Copy</Button></div></div>}
        <Card title="Invoices" pad={false}><Table head={['Date', 'Amount', 'Cycle', 'Status']}>{data.invoices.map((i) => <tr key={i.id}><Td>{date(i.created_at)}</Td><Td>{inr(i.amount)}</Td><Td>{i.cycle}</Td><Td><Badge tone={statusTone(i.status)}>{i.status}</Badge></Td></tr>)}</Table></Card>
      </div>}
    </Drawer>
  )
}

function PlanEditor({ plan, onClose, onSaved }: { plan: Partial<Plan>; onClose: () => void; onSaved: () => void }) {
  const t = useToast()
  const [f, setF] = useState(JSON.stringify({ code: plan.code ?? '', name: plan.name ?? '', tagline: plan.tagline ?? '', price_monthly: plan.price_monthly ?? 0, price_yearly: plan.price_yearly ?? 0,
    limits: plan.limits ?? { numbers: 1, users: 3, contacts: 1000, messages: 5000, flows: 3, ai_replies: 100, campaigns: 10 }, features: plan.features ?? ['flows'], is_public: !!(plan.is_public ?? 1), sort: plan.sort ?? 9 }, null, 2))
  return (
    <Modal open onClose={onClose} title={plan.id ? `Edit ${plan.name}` : 'New plan'} wide footer={<Button onClick={async () => {
      try { const body = JSON.parse(f); if (plan.id) await put(`/api/admin/plans/${plan.id}`, body); else await post('/api/admin/plans', body); t.ok('Plan saved'); onSaved(); onClose() } catch (e) { t.err(e) }
    }}>Save plan</Button>}>
      <p className="mb-3 text-xs text-muted">Limits: -1 = unlimited. Features: flows, sequences, ai, api, webhooks, catalog, payments, priority_support.</p>
      <Textarea rows={18} className="font-mono text-xs" value={f} onChange={(e) => setF(e.target.value)} />
    </Modal>
  )
}

export default function Admin() {
  const { user } = useSession()
  const t = useToast()
  const [tab, setTab] = useState<'overview' | 'clients' | 'plans' | 'leads'>('overview')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const { data: o } = useApi<Record<string, number>>('/api/admin/overview')
  const { data: ws, reload } = useApi<WsRow[]>(`/api/admin/workspaces?q=${encodeURIComponent(dq)}`)
  const { data: plans, reload: rp } = useApi<Plan[]>('/api/admin/plans')
  const { data: leads, reload: rl } = useApi<{ id: number; name: string; email: string; phone: string; company: string; message: string; status: string; created_at: string }[]>(tab === 'leads' ? '/api/admin/leads' : null)
  const [open, setOpen] = useState<number | null>(null)
  const [plan, setPlan] = useState<Partial<Plan> | null>(null)
  const [nc, setNc] = useState<{ open: boolean; company: string; name: string; email: string; password: string; plan_id: number }>({ open: false, company: '', name: '', email: '', password: '', plan_id: 0 })
  if (!user?.is_super_admin) return <div className="p-10 text-center text-muted">MECGURA admin access only.</div>
  return (
    <div className="min-h-svh">
      <header className="flex h-16 items-center justify-between border-b border-line bg-panel px-4 sm:px-6">
        <div className="flex items-center gap-4"><Link to="/app" className="text-muted hover:text-white"><ArrowLeft className="size-5" /></Link><Logo className="h-7" showProduct={false} /><Badge tone="green">Admin console</Badge></div>
        <span className="text-sm text-muted">{user.email}</span>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-6"><Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'clients', label: 'Clients' }, { id: 'plans', label: 'Plans' }, { id: 'leads', label: `Website leads${o?.new_leads ? ` (${o.new_leads})` : ''}` }]} /></div>
        {tab === 'overview' && (!o ? <Loading /> : <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Workspaces" value={num(o.workspaces)} hint={`${o.active} paid · ${o.trialing} trial · ${o.suspended} suspended`} icon={<Building2 className="size-4" />} />
          <Stat label="MRR (active plans)" value={inr(o.mrr)} icon={<IndianRupee className="size-4" />} />
          <Stat label="Revenue this month" value={inr(o.revenue_month)} icon={<IndianRupee className="size-4" />} />
          <Stat label="Messages this month" value={num(o.messages_month)} icon={<Send className="size-4" />} />
          <Stat label="Users" value={num(o.users)} icon={<Users className="size-4" />} />
          <Stat label="Live numbers" value={num(o.numbers)} icon={<Smartphone className="size-4" />} />
          <Stat label="New website leads" value={num(o.new_leads)} icon={<Inbox className="size-4" />} />
        </div>)}
        {tab === 'clients' && <>
          <div className="mb-4 flex gap-2"><Input placeholder="Search client" value={q} onChange={(e) => setQ(e.target.value)} /><Button icon={<Plus className="size-4" />} onClick={() => setNc({ ...nc, open: true })}>New client</Button></div>
          <Card pad={false}>{!ws ? <Loading /> : <Table head={['Client', 'Plan', 'Status', 'Numbers', 'Contacts', 'Msgs (month)', 'Renews', 'Created']}>
            {ws.map((w) => <tr key={w.id} className="cursor-pointer hover:bg-white/[.02]" onClick={() => setOpen(w.id)}>
              <Td><div className="font-medium text-white">{w.name}</div><div className="text-xs text-muted">{w.owner_email}</div></Td><Td>{w.plan}</Td>
              <Td><Badge tone={statusTone(w.status === 'suspended' ? 'suspended' : w.subscription_status)}>{w.status === 'suspended' ? 'suspended' : w.subscription_status}</Badge></Td>
              <Td>{w.numbers}</Td><Td>{num(w.contacts)}</Td><Td>{num(w.messages_month)}</Td><Td className="text-xs">{date(w.current_period_end)}</Td><Td className="text-xs">{date(w.created_at)}</Td></tr>)}
          </Table>}</Card>
        </>}
        {tab === 'plans' && <>
          <div className="mb-4 flex justify-end"><Button icon={<Plus className="size-4" />} onClick={() => setPlan({})}>New plan</Button></div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{plans?.map((p) => <Card key={p.id}><div className="flex justify-between"><b className="text-white">{p.name}</b>{!p.is_public && <Badge>hidden</Badge>}</div>
            <div className="mt-1 text-sm text-brand-2">{p.price_monthly ? `${inr(p.price_monthly)}/mo · ${inr(p.price_yearly)}/yr` : 'Custom'}</div>
            <div className="mt-3 space-y-0.5 text-xs text-muted">{Object.entries(p.limits).map(([k, v]) => <div key={k}>{titleCase(k)}: {v < 0 ? '∞' : num(v)}</div>)}</div>
            <Button size="sm" variant="subtle" className="mt-3" onClick={() => setPlan(p)}>Edit</Button></Card>)}</div>
        </>}
        {tab === 'leads' && <Card pad={false}><Table head={['Lead', 'Company', 'Message', 'Received', 'Status']}>
          {leads?.map((l) => <tr key={l.id}><Td><div className="text-white">{l.name}</div><div className="text-xs text-muted">{l.email} · {l.phone}</div></Td><Td>{l.company}</Td><Td className="max-w-md text-xs">{l.message}</Td><Td className="text-xs">{dateTime(l.created_at)}</Td>
            <Td><Select className="!h-8 w-32 text-xs" value={l.status} onChange={async (e) => { await patch(`/api/admin/leads/${l.id}`, { status: e.target.value }); void rl() }}>{['new', 'contacted', 'converted', 'closed'].map((s) => <option key={s}>{s}</option>)}</Select></Td></tr>)}
        </Table></Card>}
      </main>
      {open && <Client id={open} plans={plans ?? []} onClose={() => setOpen(null)} onChanged={reload} />}
      {plan && <PlanEditor plan={plan} onClose={() => setPlan(null)} onSaved={rp} />}
      <Modal open={nc.open} onClose={() => setNc({ ...nc, open: false })} title="Create client workspace" footer={<Button onClick={async () => {
        try { const r = await post<{ id: number }>('/api/admin/workspaces', { company: nc.company, name: nc.name, email: nc.email, password: nc.password, plan_id: nc.plan_id || undefined }); t.ok('Client created'); setNc({ ...nc, open: false }); void reload(); setOpen(r.id) } catch (e) { t.err(e) }
      }}>Create</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name"><Input value={nc.company} onChange={(e) => setNc({ ...nc, company: e.target.value })} /></Field>
          <Field label="Owner name"><Input value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} /></Field>
          <Field label="Owner email"><Input value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></Field>
          <Field label="Temporary password"><Input value={nc.password} onChange={(e) => setNc({ ...nc, password: e.target.value })} /></Field>
          <Field label="Activate plan (optional)" className="sm:col-span-2"><Select value={nc.plan_id} onChange={(e) => setNc({ ...nc, plan_id: Number(e.target.value) })}><option value={0}>Start with 14-day trial</option>{plans?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        </div>
      </Modal>
    </div>
  )
}

