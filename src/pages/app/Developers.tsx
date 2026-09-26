import { useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound, Plus, Trash2, Copy, Send, Webhook } from 'lucide-react'
import { post, patch, del } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { dateTime, ago } from '../../lib/format'
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Table, Td, Toggle, useToast, statusTone, Confirm, cx } from '../../components/ui'

type Dev = { keys: { id: number; name: string; prefix: string; last_used_at: string | null; revoked_at: string | null; created_at: string }[]
  webhooks: { id: number; url: string; events: string[]; secret: string; is_active: number; failure_count: number }[]
  deliveries: { id: number; webhook_id: number; event: string; status: string; status_code: number | null; attempts: number; created_at: string; response: string | null }[]; events: string[]; base_url: string }

export default function Developers() {
  const t = useToast()
  const { data, reload } = useApi<Dev>('developers')
  const [keyModal, setKeyModal] = useState({ open: false, name: '', key: '' })
  const [hook, setHook] = useState({ open: false, url: '', events: ['*'] as string[] })
  const [confirm, setConfirm] = useState<(() => Promise<void>) | null>(null)
  if (!data) return <Loading />
  const copy = (v: string) => { void navigator.clipboard.writeText(v); t.ok('Copied') }
  return (
    <>
      <PageHeader title="API & webhooks" subtitle={<>Connect your website, CRM or apps. <Link to="/docs" className="text-brand-2">Read the API docs →</Link></>} />
      <Card title={<span className="flex items-center gap-2"><KeyRound className="size-4 text-brand" />API keys</span>} action={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setKeyModal({ open: true, name: '', key: '' })}>New key</Button>} pad={false}>
        <div className="flex items-center gap-2 border-b border-line px-5 py-3 text-xs"><span className="text-muted">Base URL</span><code className="text-white">{data.base_url}</code><button onClick={() => copy(data.base_url)}><Copy className="size-3.5 text-muted" /></button></div>
        {data.keys.length === 0 ? <Empty title="No API keys" text="Create a key to send messages and sync contacts from your systems." /> : (
          <Table head={['Name', 'Key', 'Last used', 'Created', '']}>
            {data.keys.map((k) => <tr key={k.id} className={k.revoked_at ? 'opacity-50' : ''}><Td className="text-white">{k.name}</Td><Td><code className="text-xs">{k.prefix}••••••</code></Td><Td className="text-xs">{k.last_used_at ? `${ago(k.last_used_at)} ago` : 'Never'}</Td><Td className="text-xs">{dateTime(k.created_at)}</Td>
              <Td className="text-right">{k.revoked_at ? <Badge tone="red">revoked</Badge> : <button className="text-muted hover:text-red-300" onClick={() => setConfirm(() => async () => { await del(`developers/keys/${k.id}`); void reload() })}><Trash2 className="size-4" /></button>}</Td></tr>)}
          </Table>
        )}
      </Card>

      <Card className="mt-5" title={<span className="flex items-center gap-2"><Webhook className="size-4 text-brand" />Webhooks</span>} action={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setHook({ open: true, url: '', events: ['*'] })}>Add endpoint</Button>}>
        {data.webhooks.length === 0 ? <Empty title="No endpoints" text="Get real-time events for messages, contacts, orders and payments." /> : (
          <div className="space-y-3">
            {data.webhooks.map((w) => (
              <div key={w.id} className="rounded-xl border border-line bg-panel p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Toggle checked={!!w.is_active} onChange={async (v) => { await patch(`developers/webhooks/${w.id}`, { is_active: v }); void reload() }} />
                  <code className="min-w-0 flex-1 truncate text-sm text-white">{w.url}</code>
                  {w.failure_count > 0 && <Badge tone="red">{w.failure_count} failures</Badge>}
                  <Button size="sm" variant="subtle" icon={<Send className="size-3.5" />} onClick={async () => { await post(`developers/webhooks/${w.id}/test`); t.ok('Test event queued'); setTimeout(reload, 5000) }}>Test</Button>
                  <button className="text-muted hover:text-red-300" onClick={() => setConfirm(() => async () => { await del(`developers/webhooks/${w.id}`); void reload() })}><Trash2 className="size-4" /></button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">{w.events.map((e) => <Badge key={e}>{e === '*' ? 'all events' : e}</Badge>)}</div>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted">Signing secret <code className="text-soft">{w.secret.slice(0, 10)}••••</code><button onClick={() => copy(w.secret)}><Copy className="size-3.5" /></button></div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {data.deliveries.length > 0 && <Card className="mt-5" title="Recent deliveries" pad={false}>
        <Table head={['Event', 'Status', 'HTTP', 'Attempts', 'Time', 'Response']}>
          {data.deliveries.map((d) => <tr key={d.id}><Td className="text-white">{d.event}</Td><Td><Badge tone={statusTone(d.status === 'retrying' ? 'pending' : d.status)}>{d.status}</Badge></Td><Td>{d.status_code ?? '—'}</Td><Td>{d.attempts}</Td><Td className="text-xs">{dateTime(d.created_at)}</Td><Td className="max-w-60 truncate text-xs">{d.response}</Td></tr>)}
        </Table>
      </Card>}

      <Modal open={keyModal.open} onClose={() => { setKeyModal({ open: false, name: '', key: '' }); void reload() }} title="Create API key" footer={keyModal.key ? <Button onClick={() => { setKeyModal({ open: false, name: '', key: '' }); void reload() }}>Done</Button> : <Button onClick={async () => { try { const r = await post<{ key: string }>('developers/keys', { name: keyModal.name || 'API key' }); setKeyModal({ ...keyModal, key: r.key }) } catch (e) { t.err(e) } }}>Create</Button>}>
        {keyModal.key ? <><p className="text-sm text-amber-200">Copy this key now — it will not be shown again.</p><div className="mt-3 flex gap-2"><Input readOnly value={keyModal.key} className="font-mono text-xs" /><Button variant="subtle" onClick={() => copy(keyModal.key)}><Copy className="size-4" /></Button></div></>
          : <Field label="Name"><Input value={keyModal.name} onChange={(e) => setKeyModal({ ...keyModal, name: e.target.value })} placeholder="Website / CRM / Zapier" /></Field>}
      </Modal>
      <Modal open={hook.open} onClose={() => setHook({ ...hook, open: false })} title="Add webhook endpoint" footer={<Button onClick={async () => { try { await post('developers/webhooks', { url: hook.url, events: hook.events }); setHook({ ...hook, open: false }); void reload() } catch (e) { t.err(e) } }}>Add endpoint</Button>}>
        <Field label="HTTPS URL"><Input value={hook.url} onChange={(e) => setHook({ ...hook, url: e.target.value })} placeholder="https://yourapp.com/webhooks/mecgura" /></Field>
        <div className="mt-4 text-xs font-medium text-soft">Events</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['*', ...data.events].map((e) => { const on = hook.events.includes(e); return <button key={e} onClick={() => setHook({ ...hook, events: e === '*' ? ['*'] : on ? hook.events.filter((x) => x !== e) : [...hook.events.filter((x) => x !== '*'), e] })}
            className={cx('rounded-lg border px-2.5 py-1 text-xs', on ? 'border-brand/50 bg-brand/10 text-white' : 'border-line text-muted')}>{e === '*' ? 'All events' : e}</button> })}
        </div>
      </Modal>
      <Confirm open={!!confirm} onClose={() => setConfirm(null)} title="Are you sure?" text="This cannot be undone. Integrations using it will stop working." onConfirm={async () => { await confirm?.() }} />
    </>
  )
}
