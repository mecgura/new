import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Trash2, Plus, CreditCard, Sparkles, Copy } from 'lucide-react'
import { post, put, patch, del } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { useSession } from '../../lib/session'
import { dateTime } from '../../lib/format'
import { Button, Card, Field, Input, Loading, PageHeader, Select, Table, Tabs, Td, Textarea, Toggle, useToast, Badge } from '../../components/ui'

type WS = { name: string; timezone: string; business: Record<string, string>; settings: { agents_see_all?: boolean } }
type Integ = { provider: string; enabled: number; config: Record<string, string>; webhook_url?: string }

function Profile() {
  const { user, setSession } = useSession()
  const t = useToast()
  const [f, setF] = useState({ name: user?.name ?? '', phone: user?.phone ?? '', current_password: '', new_password: '' })
  return (
    <Card title="Your profile">
      <div className="grid max-w-xl gap-4 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Mobile"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><Input disabled value={user?.email ?? ''} /></Field><div />
        <Field label="Current password"><Input type="password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></Field>
        <Field label="New password"><Input type="password" value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></Field>
      </div>
      <Button className="mt-5" onClick={async () => {
        try { const r = await patch<Parameters<typeof setSession>[0]>('/api/auth/me', { name: f.name, phone: f.phone, ...(f.new_password ? { current_password: f.current_password, new_password: f.new_password } : {}) }); setSession(r); setF({ ...f, current_password: '', new_password: '' }); t.ok('Profile saved') } catch (e) { t.err(e) }
      }}>Save profile</Button>
    </Card>
  )
}

function Workspace() {
  const { data } = useApi<WS>('workspace')
  return data ? <WorkspaceForm initial={data} /> : <Loading />
}

function WorkspaceForm({ initial }: { initial: WS }) {
  const t = useToast()
  const { refresh, can } = useSession()
  const [f, setF] = useState<WS>(initial)
  const b = f.business ?? {}
  const setB = (k: string, v: string) => setF({ ...f, business: { ...b, [k]: v } })
  return (
    <Card title="Workspace & business details">
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <Field label="Workspace / business name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Time zone"><Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>{['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'Australia/Sydney'].map((z) => <option key={z}>{z}</option>)}</Select></Field>
        <Field label="Industry"><Input value={b.industry ?? ''} onChange={(e) => setB('industry', e.target.value)} /></Field>
        <Field label="Website"><Input value={b.website ?? ''} onChange={(e) => setB('website', e.target.value)} /></Field>
        <Field label="Business phone"><Input value={b.phone ?? ''} onChange={(e) => setB('phone', e.target.value)} /></Field>
        <Field label="Business email"><Input value={b.email ?? ''} onChange={(e) => setB('email', e.target.value)} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={b.address ?? ''} onChange={(e) => setB('address', e.target.value)} /></Field>
        <Field label="GSTIN (for invoices)"><Input value={b.gstin ?? ''} onChange={(e) => setB('gstin', e.target.value)} /></Field>
      </div>
      <div className="mt-5"><Toggle checked={!!f.settings.agents_see_all} onChange={(v) => setF({ ...f, settings: { ...f.settings, agents_see_all: v } })} label="Agents can see all conversations (not only assigned/unassigned)" /></div>
      <Button className="mt-5" disabled={!can('settings.manage')} onClick={async () => { try { await patch('workspace', { name: f.name, timezone: f.timezone, business: f.business, settings: { agents_see_all: !!f.settings.agents_see_all } }); t.ok('Saved'); void refresh() } catch (e) { t.err(e) } }}>Save changes</Button>
    </Card>
  )
}

function Integrations() {
  const t = useToast()
  const { data, reload } = useApi<Integ[]>('integrations')
  const [ai, setAi] = useState({ api_key: '' })
  const [secret, setSecret] = useState('')
  const [rzEdit, setRzEdit] = useState<{ key_id: string; key_secret: string } | null>(null)
  const r = data?.find((x) => x.provider === 'razorpay')
  const a = data?.find((x) => x.provider === 'anthropic')
  if (!data) return <Loading />
  const rz = rzEdit ?? { key_id: r?.config.key_id ?? '', key_secret: r?.config.key_secret ?? '' }
  const setRz = (v: { key_id: string; key_secret: string }) => setRzEdit(v)
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><CreditCard className="size-4 text-brand" />Razorpay — collect payments</span>} action={r && <Badge tone="green">connected</Badge>}>
        <p className="mb-4 text-sm text-muted">Use your own Razorpay account. Money goes directly to you. Keys from Razorpay Dashboard → Account & Settings → API Keys.</p>
        <div className="space-y-3">
          <Field label="Key ID"><Input value={rz.key_id} onChange={(e) => setRz({ ...rz, key_id: e.target.value.trim() })} placeholder="rzp_live_…" /></Field>
          <Field label="Key secret"><Input type="password" value={rz.key_secret} onChange={(e) => setRz({ ...rz, key_secret: e.target.value.trim() })} /></Field>
        </div>
        <Button className="mt-4" onClick={async () => { try { const res = await put<{ webhook_secret?: string }>('integrations/razorpay', { config: rz }); setSecret(res.webhook_secret ?? ''); t.ok('Razorpay connected'); void reload() } catch (e) { t.err(e) } }}>Save</Button>
        {r?.webhook_url && <div className="mt-5 rounded-xl border border-line bg-panel p-3 text-xs text-muted">
          In Razorpay → Webhooks add URL <code className="text-white">{r.webhook_url}</code> with event <b className="text-soft">payment_link.paid</b>{secret && <> and secret <code className="text-white">{secret}</code> <button onClick={() => { void navigator.clipboard.writeText(secret); t.ok('Copied') }}><Copy className="inline size-3" /></button></>}.
          {!secret && ' The webhook secret is shown once after saving.'}
        </div>}
      </Card>
      <Card title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-brand" />AI provider (optional)</span>} action={a && <Badge tone="green">own key</Badge>}>
        <p className="mb-4 text-sm text-muted">AI replies use MECGURA’s AI by default within your plan limits. Add your own Anthropic API key to use your own account instead.</p>
        <Field label="Anthropic API key"><Input type="password" value={ai.api_key || (a ? '••••••••' : '')} onChange={(e) => setAi({ api_key: e.target.value.trim() })} placeholder="sk-ant-…" /></Field>
        <div className="mt-4 flex gap-2"><Button onClick={async () => { try { await put('integrations/anthropic', { config: ai }); t.ok('Saved'); void reload() } catch (e) { t.err(e) } }}>Save</Button>
          {a && <Button variant="ghost" onClick={async () => { await del('integrations/anthropic'); setAi({ api_key: '' }); void reload() }}>Remove</Button>}</div>
      </Card>
      <Card title="Google Sheets, Zapier, Make, Shopify & more">
        <p className="text-sm text-muted">Use <b className="text-soft">API & Webhooks</b> to connect any tool: push new leads to Google Sheets via Zapier/Make, create contacts from your website forms, or send order updates from Shopify/WooCommerce. MECGURA can set these up for you — {`hello@mecgura.com`}.</p>
      </Card>
    </div>
  )
}

function QuickReplies() {
  const t = useToast()
  const { data, reload } = useApi<{ id: number; shortcut: string; body: string }[]>('quick-replies')
  const [f, setF] = useState({ shortcut: '', body: '' })
  return (
    <Card title="Quick replies" pad={false}>
      <form className="grid gap-2 border-b border-line p-4 sm:grid-cols-[160px_1fr_auto]" onSubmit={async (e) => { e.preventDefault(); try { await post('quick-replies', f); setF({ shortcut: '', body: '' }); void reload() } catch (er) { t.err(er) } }}>
        <Input placeholder="/shortcut" value={f.shortcut} onChange={(e) => setF({ ...f, shortcut: e.target.value.replace(/^\//, '') })} />
        <Input placeholder="Reply text" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <Button icon={<Plus className="size-4" />}>Add</Button>
      </form>
      <Table head={['Shortcut', 'Message', '']}>
        {data?.map((q) => <tr key={q.id}><Td className="font-mono text-brand-2">/{q.shortcut}</Td><Td className="max-w-lg">{q.body}</Td><Td className="text-right"><button onClick={async () => { await del(`quick-replies/${q.id}`); void reload() }} className="text-muted hover:text-red-300"><Trash2 className="size-4" /></button></Td></tr>)}
      </Table>
      <p className="px-4 py-3 text-xs text-muted">Type / in the inbox to insert a quick reply.</p>
    </Card>
  )
}

function Workspaces() {
  const t = useToast()
  const { workspaces, switchWorkspace, setSession } = useSession()
  const [name, setName] = useState('')
  return (
    <Card title="Your workspaces">
      <p className="mb-4 text-sm text-muted">Each workspace has its own WhatsApp numbers, team, contacts and plan — ideal for multiple brands or agency clients.</p>
      <div className="divide-y divide-line rounded-xl border border-line">
        {workspaces.map((w) => <div key={w.id} className="flex items-center justify-between px-4 py-3"><div><div className="text-white">{w.name}</div><div className="text-xs capitalize text-muted">{w.role} · {w.plan}</div></div><Button size="sm" variant="subtle" onClick={() => switchWorkspace(w.id)}>Open</Button></div>)}
      </div>
      <form className="mt-4 flex gap-2" onSubmit={async (e) => { e.preventDefault(); try { const r = await post<Parameters<typeof setSession>[0] & { id: number }>('/api/auth/workspaces', { name }); setSession(r); switchWorkspace(r.id) } catch (er) { t.err(er) } }}>
        <Input placeholder="New workspace name" value={name} onChange={(e) => setName(e.target.value)} /><Button disabled={name.length < 2}>Create</Button>
      </form>
    </Card>
  )
}

function Audit() {
  const { data } = useApi<{ id: number; action: string; user_name: string | null; meta: unknown; created_at: string }[]>('audit')
  return (
    <Card title="Audit log" pad={false}>
      <Table head={['When', 'Who', 'Action', 'Details']}>
        {data?.map((a) => <tr key={a.id}><Td className="text-xs">{dateTime(a.created_at)}</Td><Td>{a.user_name ?? 'System'}</Td><Td className="text-white">{a.action}</Td><Td className="max-w-md truncate text-xs">{JSON.stringify(a.meta)}</Td></tr>)}
      </Table>
    </Card>
  )
}

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const { can } = useSession()
  const tab = params.get('tab') ?? 'profile'
  const tabs = [{ id: 'profile', label: 'Profile' }, { id: 'workspace', label: 'Workspace' }, ...(can('settings.manage') ? [{ id: 'integrations', label: 'Integrations' }] : []),
    { id: 'quick', label: 'Quick replies' }, { id: 'workspaces', label: 'Workspaces' }, ...(can('settings.manage') ? [{ id: 'audit', label: 'Audit log' }] : [])]
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mb-5"><Tabs tabs={tabs} value={tab} onChange={(v) => setParams({ tab: v })} /></div>
      {tab === 'profile' && <Profile />}
      {tab === 'workspace' && <Workspace />}
      {tab === 'integrations' && <Integrations />}
      {tab === 'quick' && <QuickReplies />}
      {tab === 'workspaces' && <Workspaces />}
      {tab === 'audit' && <Audit />}
    </>
  )
}
