import { useState } from 'react'
import { Plus, Bot, Pencil, Trash2, Clock, Hand, MoonStar } from 'lucide-react'
import { post, put, del, patch } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Textarea, Toggle, TagInput, useToast, Confirm, cx } from '../../components/ui'
import ReplyEditor from '../../components/ReplyEditor'
import { emptyReply, replyText, type Reply } from '../../lib/reply'
import type { BotRule } from '../../lib/types'

type Settings = { welcome?: { enabled?: boolean; text?: string }; away?: { enabled?: boolean; text?: string }; hours?: { enabled?: boolean; days?: number[]; start?: string; end?: string }; opt_out_keywords?: string[] }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function RuleModal({ rule, onClose, onSaved }: { rule: Partial<BotRule>; onClose: () => void; onSaved: () => void }) {
  const t = useToast()
  const [r, setR] = useState<Partial<BotRule>>({ name: '', match_type: 'contains', keywords: [], reply: emptyReply, priority: 0, is_active: 1, ...rule })
  const [busy, setBusy] = useState(false)
  return (
    <Modal open onClose={onClose} title={rule.id ? 'Edit chatbot rule' : 'New chatbot rule'} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => {
      setBusy(true)
      const body = { name: r.name, match_type: r.match_type, keywords: r.keywords, reply: r.reply, priority: Number(r.priority) || 0, is_active: !!r.is_active }
      try { if (rule.id) await put(`bot-rules/${rule.id}`, body); else await post('bot-rules', body); t.ok('Rule saved'); onSaved(); onClose() } catch (e) { t.err(e) } finally { setBusy(false) }
    }}>Save rule</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_180px_100px]">
          <Field label="Rule name"><Input value={r.name ?? ''} onChange={(e) => setR({ ...r, name: e.target.value })} placeholder="e.g. Pricing enquiry" /></Field>
          <Field label="When message"><Select value={r.match_type} onChange={(e) => setR({ ...r, match_type: e.target.value })}>
            <option value="contains">contains keyword</option><option value="exact">is exactly</option><option value="starts">starts with</option><option value="regex">matches regex</option><option value="any">is anything (fallback)</option>
          </Select></Field>
          <Field label="Priority"><Input type="number" value={r.priority ?? 0} onChange={(e) => setR({ ...r, priority: Number(e.target.value) })} /></Field>
        </div>
        {r.match_type !== 'any' && <Field label="Keywords" hint="Press Enter after each keyword. Not case-sensitive."><TagInput value={r.keywords ?? []} onChange={(v) => setR({ ...r, keywords: v })} placeholder="price, cost, rate…" /></Field>}
        <ReplyEditor value={(r.reply as Reply) ?? emptyReply} onChange={(reply) => setR({ ...r, reply })} />
      </div>
    </Modal>
  )
}

export default function Chatbot() {
  const { data: rules, reload } = useApi<BotRule[]>('bot-rules')
  const { data: ws } = useApi<{ settings: Settings }>('workspace')
  const [edit, setEdit] = useState<Partial<BotRule> | null>(null)
  const [delId, setDelId] = useState<number | null>(null)

  return (
    <>
      <PageHeader title="Chatbot" subtitle="Instant keyword replies, welcome & away messages. Runs after active flows and before the AI assistant." actions={<Button icon={<Plus className="size-4" />} onClick={() => setEdit({})}>New rule</Button>} />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Keyword rules" pad={false}>
          {!rules ? <Loading /> : rules.length === 0 ? <Empty icon={<Bot className="size-5" />} title="No rules yet" text="Answer common questions like price, address, timings and offers instantly." action={<Button size="sm" onClick={() => setEdit({})}>Create first rule</Button>} /> : (
            <div className="divide-y divide-line">
              {rules.map((r) => (
                <div key={r.id} className="flex items-start gap-4 px-5 py-4">
                  <Toggle checked={!!r.is_active} onChange={async (v) => { await put(`bot-rules/${r.id}`, { is_active: v }); void reload() }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span className="font-medium text-white">{r.name}</span><Badge>{r.hits} hits</Badge></div>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted">{r.match_type === 'any' ? <Badge tone="amber">fallback · any message</Badge> : <>{r.match_type}: {r.keywords.map((k) => <Badge key={k} tone="green">{k}</Badge>)}</>}</div>
                    <p className="mt-1.5 line-clamp-2 text-sm text-soft">↳ {replyText(r.reply)}</p>
                  </div>
                  <button onClick={() => setEdit(r)} className="p-1 text-muted hover:text-white"><Pencil className="size-4" /></button>
                  <button onClick={() => setDelId(r.id)} className="p-1 text-muted hover:text-red-300"><Trash2 className="size-4" /></button>
                </div>
              ))}
            </div>
          )}
        </Card>
        {ws ? <SettingsPanel initial={ws.settings} /> : <Loading />}
      </div>
      {edit && <RuleModal rule={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      <Confirm open={!!delId} onClose={() => setDelId(null)} title="Delete rule?" text="This chatbot rule will stop replying immediately." onConfirm={async () => { await del(`bot-rules/${delId}`); void reload() }} />
    </>
  )
}

function SettingsPanel({ initial }: { initial: Settings }) {
  const t = useToast()
  const [s, setS] = useState<Settings>(initial)
  const saveSettings = async () => { try { await patch('workspace', { settings: s }); t.ok('Saved') } catch (e) { t.err(e) } }
  return (
        <div className="space-y-5">
          <Card title={<span className="flex items-center gap-2"><Hand className="size-4 text-brand" />Welcome message</span>} action={<Toggle checked={!!s.welcome?.enabled} onChange={(v) => setS({ ...s, welcome: { ...s.welcome, enabled: v } })} />}>
            <Textarea rows={3} value={s.welcome?.text ?? ''} onChange={(e) => setS({ ...s, welcome: { ...s.welcome, text: e.target.value } })} />
            <p className="mt-2 text-xs text-muted">Sent once to brand-new contacts when no flow or rule matches.</p>
          </Card>
          <Card title={<span className="flex items-center gap-2"><Clock className="size-4 text-brand" />Business hours</span>} action={<Toggle checked={!!s.hours?.enabled} onChange={(v) => setS({ ...s, hours: { ...s.hours, enabled: v } })} />}>
            <div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => { const on = (s.hours?.days ?? [1, 2, 3, 4, 5, 6]).includes(i); return <button key={d} onClick={() => { const days = s.hours?.days ?? [1, 2, 3, 4, 5, 6]; setS({ ...s, hours: { ...s.hours, days: on ? days.filter((x) => x !== i) : [...days, i] } }) }} className={cx('rounded-lg border px-2.5 py-1 text-xs', on ? 'border-brand/50 bg-brand/10 text-white' : 'border-line text-muted')}>{d}</button> })}</div>
            <div className="mt-3 grid grid-cols-2 gap-3"><Field label="Opens"><Input type="time" value={s.hours?.start ?? '09:00'} onChange={(e) => setS({ ...s, hours: { ...s.hours, start: e.target.value } })} /></Field><Field label="Closes"><Input type="time" value={s.hours?.end ?? '19:00'} onChange={(e) => setS({ ...s, hours: { ...s.hours, end: e.target.value } })} /></Field></div>
          </Card>
          <Card title={<span className="flex items-center gap-2"><MoonStar className="size-4 text-brand" />Away message</span>} action={<Toggle checked={!!s.away?.enabled} onChange={(v) => setS({ ...s, away: { ...s.away, enabled: v } })} />}>
            <Textarea rows={3} value={s.away?.text ?? ''} onChange={(e) => setS({ ...s, away: { ...s.away, text: e.target.value } })} />
            <p className="mt-2 text-xs text-muted">Sent outside business hours (max once every 6 hours per chat).</p>
          </Card>
          <Card title="Opt-out keywords">
            <TagInput value={s.opt_out_keywords ?? ['stop', 'unsubscribe']} onChange={(v) => setS({ ...s, opt_out_keywords: v.map((x) => x.toLowerCase()) })} />
            <p className="mt-2 text-xs text-muted">Contacts sending these are unsubscribed from campaigns & follow-ups automatically. “START” re-subscribes.</p>
          </Card>
          <Button className="w-full" onClick={saveSettings}>Save settings</Button>
        </div>
  )
}
