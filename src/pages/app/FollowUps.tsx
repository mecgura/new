import { useState } from 'react'
import { Plus, Repeat, Trash2, Pencil, Clock } from 'lucide-react'
import { post, put, del } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Toggle, useToast, Confirm } from '../../components/ui'
import ReplyEditor from '../../components/ReplyEditor'
import { emptyReply, replyText, type Reply } from '../../lib/reply'

type Step = { delay_minutes: number; reply: Reply }
type Seq = { id: number; name: string; trigger: { type: string; value?: string }; steps: Step[]; is_active: number; stop_on_reply: number; active_count: number; total_count: number }

const fmtDelay = (m: number) => (m === 0 ? 'Immediately' : m % 1440 === 0 ? `${m / 1440} day(s)` : m % 60 === 0 ? `${m / 60} hour(s)` : `${m} min`)

function Editor({ seq, onClose, onSaved }: { seq: Partial<Seq>; onClose: () => void; onSaved: () => void }) {
  const t = useToast()
  const [s, setS] = useState<Partial<Seq>>({ name: '', trigger: { type: 'manual' }, steps: [{ delay_minutes: 60, reply: emptyReply }], is_active: 1, stop_on_reply: 1, ...seq })
  const [busy, setBusy] = useState(false)
  const steps = s.steps ?? []
  const setStep = (i: number, st: Partial<Step>) => setS({ ...s, steps: steps.map((x, j) => (j === i ? { ...x, ...st } : x)) })
  return (
    <Modal open onClose={onClose} title={seq.id ? 'Edit follow-up sequence' : 'New follow-up sequence'} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={async () => {
      setBusy(true)
      const body = { name: s.name, trigger: s.trigger, steps, is_active: !!s.is_active, stop_on_reply: !!s.stop_on_reply }
      try { if (seq.id) await put(`sequences/${seq.id}`, body); else await post('sequences', body); t.ok('Saved'); onSaved(); onClose() } catch (e) { t.err(e) } finally { setBusy(false) }
    }}>Save sequence</Button></>}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" className="sm:col-span-1"><Input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="New lead nurture" /></Field>
          <Field label="Start when"><Select value={s.trigger?.type} onChange={(e) => setS({ ...s, trigger: { type: e.target.value } })}><option value="manual">Added manually / by flow</option><option value="tag_added">A tag is added</option></Select></Field>
          {s.trigger?.type === 'tag_added' && <Field label="Tag"><Input value={s.trigger.value ?? ''} onChange={(e) => setS({ ...s, trigger: { ...s.trigger!, value: e.target.value } })} /></Field>}
        </div>
        <Toggle checked={!!s.stop_on_reply} onChange={(v) => setS({ ...s, stop_on_reply: v ? 1 : 0 })} label="Stop the sequence when the contact replies" />
        <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200">WhatsApp only allows free-form messages within 24 hours of the customer’s last message. For later steps use a template reply.</p>
        {steps.map((st, i) => (
          <div key={i} className="rounded-2xl border border-line bg-panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm"><Badge tone="green">Step {i + 1}</Badge><Clock className="size-4 text-muted" />wait
                <Input type="number" min={0} className="!h-8 w-20 text-xs" value={st.delay_minutes} onChange={(e) => setStep(i, { delay_minutes: Number(e.target.value) })} /><span className="text-muted">minutes ({fmtDelay(st.delay_minutes)})</span></div>
              {steps.length > 1 && <button onClick={() => setS({ ...s, steps: steps.filter((_, j) => j !== i) })} className="text-muted hover:text-red-300"><Trash2 className="size-4" /></button>}
            </div>
            <ReplyEditor value={st.reply} onChange={(reply) => setStep(i, { reply })} preview={false} />
          </div>
        ))}
        <Button variant="subtle" icon={<Plus className="size-4" />} onClick={() => setS({ ...s, steps: [...steps, { delay_minutes: 1440, reply: emptyReply }] })}>Add step</Button>
      </div>
    </Modal>
  )
}

export default function FollowUps() {
  const { data, reload } = useApi<Seq[]>('sequences')
  const [edit, setEdit] = useState<Partial<Seq> | null>(null)
  const [delId, setDelId] = useState<number | null>(null)
  return (
    <>
      <PageHeader title="Follow-up sequences" subtitle="Automatic drip messages that nurture leads and remind customers — stop as soon as they reply." actions={<Button icon={<Plus className="size-4" />} onClick={() => setEdit({})}>New sequence</Button>} />
      {!data ? <Loading /> : data.length === 0 ? <Card><Empty icon={<Repeat className="size-5" />} title="No follow-ups yet" text="Example: Day 0 thank-you → Day 1 brochure → Day 3 offer reminder." action={<Button onClick={() => setEdit({})}>Create sequence</Button>} /></Card> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((s) => (
            <Card key={s.id}>
              <div className="flex items-start justify-between gap-3">
                <div><div className="font-display font-semibold text-white">{s.name}</div><div className="mt-1 flex gap-1.5"><Badge tone="blue">{s.trigger.type === 'tag_added' ? `Tag: ${s.trigger.value}` : 'Manual / flow'}</Badge><Badge>{s.steps.length} steps</Badge><Badge tone="green">{s.active_count} active</Badge></div></div>
                <Toggle checked={!!s.is_active} onChange={async (v) => { await put(`sequences/${s.id}`, { is_active: v }); void reload() }} />
              </div>
              <ol className="mt-4 space-y-2 border-l border-line-strong pl-4">
                {s.steps.map((st, i) => <li key={i} className="text-sm"><span className="text-xs text-brand-2">{fmtDelay(st.delay_minutes)}</span><p className="line-clamp-1 text-soft">{replyText(st.reply)}</p></li>)}
              </ol>
              <div className="mt-4 flex justify-end gap-2"><Button size="sm" variant="subtle" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(s)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setDelId(s.id)}><Trash2 className="size-4" /></Button></div>
            </Card>
          ))}
        </div>
      )}
      {edit && <Editor seq={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      <Confirm open={!!delId} onClose={() => setDelId(null)} title="Delete sequence?" text="Contacts currently in this sequence will stop receiving it." onConfirm={async () => { await del(`sequences/${delId}`); void reload() }} />
    </>
  )
}
