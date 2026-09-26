import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Workflow, Copy, Trash2, Play } from 'lucide-react'
import { post, put, del } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { date, num, pct } from '../../lib/format'
import { Badge, Button, Card, Empty, Loading, PageHeader, Toggle, useToast, Confirm } from '../../components/ui'
import type { Flow } from '../../lib/types'

const TEMPLATES = [
  { name: 'Lead qualification', description: 'Ask interest & name, tag as hot lead, hand over to sales', trigger: { type: 'keyword', value: 'hi,hello,info', match: 'exact' }, nodes: [
    { id: 'n1', type: 'message', data: { reply: { type: 'text', text: 'Hi {{first_name}} 👋 Thanks for reaching out!' } }, next: 'n2' },
    { id: 'n2', type: 'buttons', data: { text: 'What can we help you with?', options: ['Pricing', 'Book a demo', 'Support'], save_as: 'interest' }, branches: { 0: 'n3', 1: 'n3', 2: 'n5', other: 'n3' } },
    { id: 'n3', type: 'question', data: { text: 'Great! May I know your business name?', save_as: 'business_name' }, next: 'n4' },
    { id: 'n4', type: 'action', data: { action: 'add_tag', value: 'hot-lead' }, next: 'n5' },
    { id: 'n5', type: 'handoff', data: { text: 'Thank you! Our team will reply shortly.' } },
  ] },
  { name: 'Appointment booking', description: 'Collect preferred day & time, confirm and notify team', trigger: { type: 'keyword', value: 'book,appointment', match: 'contains' }, nodes: [
    { id: 'n1', type: 'buttons', data: { text: 'Which day works for you?', options: ['Today', 'Tomorrow', 'This weekend'], save_as: 'day' }, branches: { other: 'n2' }, next: 'n2' },
    { id: 'n2', type: 'question', data: { text: 'What time would you prefer? (e.g. 4 pm)', save_as: 'time' }, next: 'n3' },
    { id: 'n3', type: 'action', data: { action: 'notify', value: 'New booking: {{name}} · {{day}} {{time}}' }, next: 'n4' },
    { id: 'n4', type: 'message', data: { reply: { type: 'text', text: '✅ Request received for {{day}} at {{time}}. We will confirm shortly!' } } },
  ] },
  { name: 'Blank flow', description: '', trigger: { type: 'keyword', value: '', match: 'exact' }, nodes: [{ id: 'n1', type: 'message', data: { reply: { type: 'text', text: 'Hello {{first_name}}!' } } }] },
]

const triggerLabel = (tr: Flow['trigger']) => tr.type === 'keyword' ? `Keyword: ${tr.value || '—'}` : tr.type === 'new_contact' ? 'New contact' : tr.type === 'any_message' ? 'Any message' : tr.type === 'tag_added' ? `Tag added: ${tr.value}` : tr.type === 'api' ? 'API trigger' : 'Manual'

export default function Flows() {
  const t = useToast()
  const nav = useNavigate()
  const { data, reload } = useApi<Flow[]>('flows')
  const [pick, setPick] = useState(false)
  const [delId, setDelId] = useState<number | null>(null)
  const create = async (tpl: (typeof TEMPLATES)[number]) => { try { const f = await post<Flow>('flows', { ...tpl, is_active: false }); nav(`/app/flows/${f.id}`) } catch (e) { t.err(e) } }
  return (
    <>
      <PageHeader title="Flow builder" subtitle="Multi-step conversations with buttons, questions, conditions, delays, webhooks, AI and human handoff." actions={<Button icon={<Plus className="size-4" />} onClick={() => setPick(!pick)}>New flow</Button>} />
      {pick && <div className="mb-6 grid gap-3 md:grid-cols-3">{TEMPLATES.map((x) => (
        <button key={x.name} onClick={() => create(x)} className="rounded-2xl border border-line bg-card p-5 text-left transition hover:border-brand/50">
          <Workflow className="size-5 text-brand" /><div className="mt-3 font-semibold text-white">{x.name}</div><div className="mt-1 text-sm text-muted">{x.description || 'Start from scratch'}</div>
        </button>
      ))}</div>}
      {!data ? <Loading /> : data.length === 0 ? <Card><Empty icon={<Workflow className="size-5" />} title="No flows yet" text="Start from a ready-made template and customise it in minutes." action={<Button onClick={() => setPick(true)}>Choose a template</Button>} /></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((f) => (
            <Card key={f.id} pad={false}>
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/app/flows/${f.id}`} className="font-display font-semibold text-white hover:text-brand-2">{f.name}</Link>
                  <Toggle checked={!!f.is_active} onChange={async (v) => { try { await put(`flows/${f.id}`, { is_active: v }); void reload() } catch (e) { t.err(e) } }} />
                </div>
                {f.description && <p className="mt-1 text-sm text-muted">{f.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5"><Badge tone="blue">{triggerLabel(f.trigger)}</Badge><Badge>{f.steps} steps</Badge></div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-panel p-2"><div className="font-semibold text-white">{num(f.runs)}</div><div className="text-[11px] text-muted">runs</div></div>
                  <div className="rounded-lg bg-panel p-2"><div className="font-semibold text-white">{num(f.completions)}</div><div className="text-[11px] text-muted">completed</div></div>
                  <div className="rounded-lg bg-panel p-2"><div className="font-semibold text-white">{pct(f.completions, f.runs)}</div><div className="text-[11px] text-muted">rate</div></div>
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-line px-5 py-2.5 text-xs text-muted">
                <span>Edited {date(f.updated_at)}</span>
                <span className="flex gap-3">
                  <Link to={`/app/flows/${f.id}`} className="hover:text-white"><Play className="size-4" /></Link>
                  <button onClick={async () => { try { await post(`flows/${f.id}/duplicate`); void reload() } catch (e) { t.err(e) } }} className="hover:text-white"><Copy className="size-4" /></button>
                  <button onClick={() => setDelId(f.id)} className="hover:text-red-300"><Trash2 className="size-4" /></button>
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Confirm open={!!delId} onClose={() => setDelId(null)} title="Delete flow?" text="Running conversations in this flow will stop." onConfirm={async () => { await del(`flows/${delId}`); void reload() }} />
    </>
  )
}
