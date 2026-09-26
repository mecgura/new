import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pause, Play, XCircle, Send, Trash2 } from 'lucide-react'
import { post, del } from '../../lib/api'
import { useApi, useEvents } from '../../lib/hooks'
import { num, pct, dateTime, phone } from '../../lib/format'
import { Badge, Button, Card, Loading, Table, Td, useToast, statusTone, Select, Confirm } from '../../components/ui'
import { TemplatePreview, type TplComponent } from '../../components/WhatsAppPreview'
import type { Campaign } from '../../lib/types'

type Detail = Campaign & { components: TplComponent[]; template_vars: { body?: string[] }; recipients: { id: number; name: string | null; wa_id: string; status: string; message_status: string | null; error: string | null; sent_at: string | null }[] }

export default function CampaignDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const t = useToast()
  const { data, reload } = useApi<Detail>(`campaigns/${id}`)
  const [filter, setFilter] = useState('')
  const [confirm, setConfirm] = useState(false)
  useEvents((type, d) => { if (type === 'campaign' && (d as Campaign).id === Number(id)) void reload() })
  if (!data) return <Loading />
  const act = async (a: string) => { try { await post(`campaigns/${id}/${a}`); void reload() } catch (e) { t.err(e) } }
  const funnel = [['Recipients', data.total], ['Sent', data.sent], ['Delivered', data.delivered], ['Read', data.read], ['Replied', data.replied]] as [string, number][]
  const rows = data.recipients.filter((r) => !filter || (r.message_status ?? r.status) === filter)
  return (
    <>
      <Link to="/app/campaigns" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-white"><ArrowLeft className="size-4" />Campaigns</Link>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="flex items-center gap-3 font-display text-2xl font-bold text-white">{data.name}<Badge tone={statusTone(data.status)}>{data.status}</Badge></h1>
          <p className="mt-1 text-sm text-muted">Template <b className="text-soft">{data.template_name}</b> · {data.status === 'scheduled' ? `scheduled for ${dateTime(data.scheduled_at)}` : `started ${dateTime(data.started_at)}`}</p></div>
        <div className="flex gap-2">
          {data.status === 'draft' && <Button icon={<Send className="size-4" />} onClick={() => act('send')}>Send now</Button>}
          {data.status === 'running' && <Button variant="outline" icon={<Pause className="size-4" />} onClick={() => act('pause')}>Pause</Button>}
          {data.status === 'paused' && <Button icon={<Play className="size-4" />} onClick={() => act('resume')}>Resume</Button>}
          {['scheduled', 'running', 'paused'].includes(data.status) && <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => act('cancel')}>Cancel</Button>}
          {['draft', 'completed', 'cancelled', 'failed', 'scheduled'].includes(data.status) && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setConfirm(true)} />}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {funnel.map(([l, v]) => <Card key={l}><div className="text-xs text-muted">{l}</div><div className="mt-1 font-display text-2xl font-bold text-white">{num(v)}</div>{l !== 'Recipients' && <div className="text-xs text-brand-2">{pct(v, data.total)}</div>}</Card>)}
          </div>
          {data.failed > 0 && <div className="rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3 text-sm text-red-200">{num(data.failed)} messages failed. Common reasons: number not on WhatsApp, template paused by Meta, or recipient blocked marketing messages.</div>}
          <Card title="Recipients" pad={false} action={<Select className="!h-8 w-36 text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">All</option>{['pending', 'sent', 'delivered', 'read', 'failed', 'replied'].map((s) => <option key={s}>{s}</option>)}</Select>}>
            <Table head={['Contact', 'Status', 'Sent at', 'Error']}>
              {rows.map((r) => <tr key={r.id}><Td><div className="text-white">{r.name || '—'}</div><div className="text-xs text-muted">{phone(r.wa_id)}</div></Td>
                <Td><Badge tone={statusTone(r.status === 'replied' ? 'read' : r.message_status ?? r.status)}>{r.status === 'replied' ? 'replied' : r.message_status ?? r.status}</Badge></Td>
                <Td className="text-xs">{dateTime(r.sent_at)}</Td><Td className="max-w-64 truncate text-xs text-red-300">{r.error}</Td></tr>)}
            </Table>
          </Card>
        </div>
        <div><TemplatePreview components={data.components ?? []} vars={data.template_vars?.body} /></div>
      </div>
      <Confirm open={confirm} onClose={() => setConfirm(false)} title="Delete campaign?" text="Campaign stats will be removed. Messages already sent are not affected." onConfirm={async () => { await del(`campaigns/${id}`); nav('/app/campaigns') }} />
    </>
  )
}
