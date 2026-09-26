import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, Save, MessageSquare, HelpCircle, ListChecks, GitBranch, Zap, Timer, Webhook, Sparkles, UserRound, CircleStop, Plus, Trash2, Flag, Play, History,
} from 'lucide-react'
import { put, post } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { dateTime, phone } from '../../lib/format'
import { Badge, Button, Field, Input, Loading, Modal, Select, Textarea, Toggle, useToast, cx, Table, Td, statusTone } from '../../components/ui'
import ReplyEditor from '../../components/ReplyEditor'
import { emptyReply, replyText, type Reply } from '../../lib/reply'
import type { Flow, FlowNode, Contact, Member } from '../../lib/types'

const TYPES: Record<string, { label: string; icon: typeof MessageSquare; color: string; hint: string }> = {
  message: { label: 'Send message', icon: MessageSquare, color: 'text-brand-2 bg-brand/15', hint: 'Text, media, buttons, list or link' },
  buttons: { label: 'Ask with buttons', icon: ListChecks, color: 'text-sky-300 bg-sky-400/15', hint: 'Up to 3 choices, branch per answer' },
  question: { label: 'Ask a question', icon: HelpCircle, color: 'text-violet-300 bg-violet-400/15', hint: 'Save the reply to a contact field' },
  condition: { label: 'Condition', icon: GitBranch, color: 'text-amber-300 bg-amber-400/15', hint: 'Branch on tags, stage or fields' },
  action: { label: 'Action', icon: Zap, color: 'text-orange-300 bg-orange-400/15', hint: 'Tag, stage, assign, notify, follow-up' },
  delay: { label: 'Wait', icon: Timer, color: 'text-teal-300 bg-teal-400/15', hint: 'Pause before the next step' },
  webhook: { label: 'Webhook', icon: Webhook, color: 'text-fuchsia-300 bg-fuchsia-400/15', hint: 'Send data to your CRM / Sheets / Zapier' },
  ai: { label: 'AI reply', icon: Sparkles, color: 'text-emerald-200 bg-emerald-300/15', hint: 'Let the AI assistant answer' },
  handoff: { label: 'Human handoff', icon: UserRound, color: 'text-rose-300 bg-rose-400/15', hint: 'Pause bot & assign to an agent' },
  end: { label: 'End', icon: CircleStop, color: 'text-muted bg-white/5', hint: 'Finish the flow' },
}

const W = 250, H = 92, GX = 50, GY = 70

function summary(n: FlowNode) {
  const d = n.data as Record<string, unknown>
  switch (n.type) {
    case 'message': return replyText(d.reply as Reply)
    case 'buttons': return `${d.text ?? ''} [${((d.options as string[]) ?? []).join(' · ')}]`
    case 'question': return `${d.text ?? ''}${d.save_as ? ` → {{${d.save_as}}}` : ''}`
    case 'condition': return `${d.field || 'tag'} ${d.op} ${d.value ?? ''}`
    case 'action': return `${String(d.action ?? '').replace('_', ' ')} ${d.value ?? ''}`
    case 'delay': return `${d.minutes ?? 1} minutes`
    case 'webhook': return String(d.url ?? 'Set URL')
    case 'handoff': return String(d.text ?? 'Assign to team')
    default: return TYPES[n.type]?.hint ?? ''
  }
}

function outs(n: FlowNode): { key: string; label: string; target: string | null | undefined }[] {
  if (n.type === 'buttons') return [...((n.data.options as string[]) ?? []).map((o, i) => ({ key: String(i), label: o || `Option ${i + 1}`, target: n.branches?.[String(i)] })), { key: 'other', label: 'Other reply', target: n.branches?.other }]
  if (n.type === 'condition') return [{ key: 'yes', label: 'Yes', target: n.branches?.yes }, { key: 'no', label: 'No', target: n.branches?.no }]
  if (n.type === 'webhook') return [{ key: 'next', label: 'Success', target: n.next }, { key: 'error', label: 'Error', target: n.branches?.error }]
  if (n.type === 'handoff' || n.type === 'end') return []
  return [{ key: 'next', label: 'Next', target: n.next }]
}

function layout(nodes: FlowNode[]) {
  const pos = new Map<string, { x: number; y: number }>()
  if (!nodes.length) return pos
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const level = new Map<string, number>()
  const queue = [nodes[0].id]; level.set(nodes[0].id, 0)
  while (queue.length) {
    const id = queue.shift()!
    for (const o of outs(byId.get(id)!)) if (o.target && byId.has(o.target) && !level.has(o.target)) { level.set(o.target, level.get(id)! + 1); queue.push(o.target) }
  }
  const maxL = Math.max(0, ...level.values())
  for (const n of nodes) if (!level.has(n.id)) level.set(n.id, maxL + 1)
  const rows = new Map<number, string[]>()
  for (const n of nodes) { const l = level.get(n.id)!; rows.set(l, [...(rows.get(l) ?? []), n.id]) }
  const widest = Math.max(...[...rows.values()].map((r) => r.length))
  for (const [l, ids] of rows) {
    const offset = ((widest - ids.length) * (W + GX)) / 2
    ids.forEach((id, i) => pos.set(id, { x: 40 + offset + i * (W + GX), y: 40 + l * (H + GY) }))
  }
  return pos
}

let seq = 0
const newId = (nodes: FlowNode[]) => { let id: string; do { id = `n${Date.now().toString(36).slice(-4)}${seq++}` } while (nodes.some((n) => n.id === id)); return id }

function defaults(type: string): Record<string, unknown> {
  switch (type) {
    case 'message': return { reply: { ...emptyReply, text: 'Hello {{first_name}}!' } }
    case 'buttons': return { text: 'Please choose an option', options: ['Option 1', 'Option 2'], save_as: '' }
    case 'question': return { text: 'What is your email?', save_as: 'email', validate: 'email' }
    case 'condition': return { field: 'tag', op: 'has_tag', value: 'vip' }
    case 'action': return { action: 'add_tag', value: 'lead' }
    case 'delay': return { minutes: 60 }
    case 'webhook': return { url: 'https://' }
    case 'handoff': return { text: 'Connecting you to our team…' }
    default: return {}
  }
}

function Inspector({ node, nodes, onChange, onDelete, onStart, isStart, members, sequences }: { node: FlowNode; nodes: FlowNode[]; onChange: (n: FlowNode) => void; onDelete: () => void; onStart: () => void; isStart: boolean; members: Member[]; sequences: { id: number; name: string }[] }) {
  const d = node.data
  const set = (patch: Record<string, unknown>) => onChange({ ...node, data: { ...d, ...patch } })
  const targetSelect = (key: string, label: string, value: string | null | undefined) => (
    <Field key={key} label={`→ ${label}`}>
      <Select value={value ?? ''} onChange={(e) => {
        const v = e.target.value || null
        if (key === 'next') onChange({ ...node, next: v })
        else onChange({ ...node, branches: { ...node.branches, [key]: v } })
      }}>
        <option value="">— end here —</option>
        {nodes.filter((n) => n.id !== node.id).map((n) => <option key={n.id} value={n.id}>{TYPES[n.type]?.label}: {summary(n).slice(0, 40)}</option>)}
      </Select>
    </Field>
  )
  const T = TYPES[node.type]
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3"><span className={cx('grid size-9 place-items-center rounded-xl', T.color)}><T.icon className="size-4" /></span><div><div className="font-semibold text-white">{T.label}</div><div className="text-xs text-muted">{T.hint}</div></div></div>
      {node.type === 'message' && <ReplyEditor value={(d.reply as Reply) ?? emptyReply} onChange={(reply) => set({ reply })} preview={false} />}
      {node.type === 'buttons' && <>
        <Field label="Question"><Textarea rows={3} value={String(d.text ?? '')} onChange={(e) => set({ text: e.target.value })} /></Field>
        <Field label="Buttons (max 3, 20 chars)">{[0, 1, 2].map((i) => <Input key={i} className="mb-2" maxLength={20} placeholder={`Option ${i + 1}`} value={((d.options as string[]) ?? [])[i] ?? ''} onChange={(e) => { const o = [...((d.options as string[]) ?? [])]; o[i] = e.target.value; set({ options: o.filter((x, j) => x || j < i) }) }} />)}</Field>
        <Field label="Save answer as field (optional)"><Input value={String(d.save_as ?? '')} onChange={(e) => set({ save_as: e.target.value.replace(/\s+/g, '_').toLowerCase() })} placeholder="interest" /></Field>
      </>}
      {node.type === 'question' && <>
        <Field label="Question"><Textarea rows={3} value={String(d.text ?? '')} onChange={(e) => set({ text: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Save as field"><Input value={String(d.save_as ?? '')} onChange={(e) => set({ save_as: e.target.value.replace(/\s+/g, '_').toLowerCase() })} /></Field>
          <Field label="Validate"><Select value={String(d.validate ?? 'any')} onChange={(e) => set({ validate: e.target.value })}><option value="any">Any text</option><option value="email">Email</option><option value="phone">Phone</option><option value="number">Number</option></Select></Field>
        </div>
        <Field label="Retry message if invalid"><Input value={String(d.retry_text ?? '')} onChange={(e) => set({ retry_text: e.target.value })} placeholder="Sorry, that does not look right…" /></Field>
        <p className="text-xs text-muted">Saving as <b>name</b> or <b>email</b> updates the contact directly. Other names become custom fields usable as {'{{field}}'}.</p>
      </>}
      {node.type === 'condition' && <>
        <Field label="Check"><Select value={String(d.op ?? 'has_tag')} onChange={(e) => set({ op: e.target.value })}>
          <option value="has_tag">Contact has tag</option><option value="not_has_tag">Contact does not have tag</option><option value="equals">Field equals</option><option value="not_equals">Field is not</option><option value="contains">Field contains</option><option value="exists">Field is filled</option><option value="gt">Field greater than</option><option value="lt">Field less than</option>
        </Select></Field>
        {!['has_tag', 'not_has_tag'].includes(String(d.op)) && <Field label="Field" hint="stage, name, email or any saved field"><Input value={String(d.field ?? '')} onChange={(e) => set({ field: e.target.value })} /></Field>}
        {d.op !== 'exists' && <Field label="Value"><Input value={String(d.value ?? '')} onChange={(e) => set({ value: e.target.value })} /></Field>}
      </>}
      {node.type === 'action' && <>
        <Field label="Action"><Select value={String(d.action ?? 'add_tag')} onChange={(e) => set({ action: e.target.value, value: '' })}>
          <option value="add_tag">Add tag</option><option value="remove_tag">Remove tag</option><option value="set_stage">Set lead stage</option><option value="set_attribute">Set custom field</option>
          <option value="assign">Assign conversation</option><option value="subscribe_sequence">Start follow-up sequence</option><option value="notify">Notify team</option><option value="resolve">Resolve conversation</option><option value="opt_out">Opt out of marketing</option>
        </Select></Field>
        {d.action === 'set_attribute' && <Field label="Field name"><Input value={String(d.key ?? '')} onChange={(e) => set({ key: e.target.value })} /></Field>}
        {d.action === 'set_stage' ? <Field label="Stage"><Select value={String(d.value ?? '')} onChange={(e) => set({ value: e.target.value })}>{['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
          : d.action === 'assign' ? <Field label="Assign to"><Select value={String(d.value ?? '')} onChange={(e) => set({ value: e.target.value })}><option value="round_robin">Round-robin (online agents)</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</Select></Field>
            : d.action === 'subscribe_sequence' ? <Field label="Sequence"><Select value={String(d.value ?? '')} onChange={(e) => set({ value: e.target.value })}><option value="">Choose…</option>{sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              : !['resolve', 'opt_out'].includes(String(d.action)) && <Field label={d.action === 'notify' ? 'Notification text' : 'Value'}><Input value={String(d.value ?? '')} onChange={(e) => set({ value: e.target.value })} /></Field>}
      </>}
      {node.type === 'delay' && <Field label="Wait (minutes)" hint="1440 = 1 day"><Input type="number" min={1} value={Number(d.minutes ?? 1)} onChange={(e) => set({ minutes: Number(e.target.value) })} /></Field>}
      {node.type === 'webhook' && <>
        <Field label="POST to URL" hint="Receives { contact, variables, flow } as JSON"><Input value={String(d.url ?? '')} onChange={(e) => set({ url: e.target.value })} /></Field>
        <Field label="Save response as (optional)"><Input value={String(d.save_as ?? '')} onChange={(e) => set({ save_as: e.target.value })} /></Field>
      </>}
      {node.type === 'handoff' && <Field label="Message before handoff"><Textarea rows={3} value={String(d.text ?? '')} onChange={(e) => set({ text: e.target.value })} /></Field>}
      {node.type === 'ai' && <p className="text-sm text-muted">The AI assistant replies to the customer&apos;s last message using your knowledge base (AI Assistant page). If it is not confident, the chat is handed to a human.</p>}

      <div className="space-y-3 border-t border-line pt-4">{outs(node).map((o) => targetSelect(o.key, o.label, o.target))}</div>
      <div className="flex gap-2 border-t border-line pt-4">
        {!isStart && <Button size="sm" variant="subtle" icon={<Flag className="size-3.5" />} onClick={onStart}>Make start step</Button>}
        <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>Delete step</Button>
      </div>
    </div>
  )
}

export default function FlowBuilder() {
  const { id } = useParams()
  const { data } = useApi<Flow>(`flows/${id}`)
  return data && String(data.id) === id ? <Editor key={data.id} initial={data} /> : <Loading />
}

function Editor({ initial }: { initial: Flow }) {
  const t = useToast()
  const { data: team } = useApi<{ members: Member[] }>('team')
  const { data: seqs } = useApi<{ id: number; name: string }[]>('sequences')
  const [flow, setFlow] = useState<Flow>(initial)
  const [sel, setSel] = useState<string | null>(initial.nodes[0]?.id ?? null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [testOpen, setTestOpen] = useState(false)
  const [runsOpen, setRunsOpen] = useState(false)
  const pos = useMemo(() => layout(flow.nodes), [flow.nodes])

  const update = (f: Flow) => { setFlow(f); setDirty(true) }
  const nodes = flow.nodes
  const selected = nodes.find((n) => n.id === sel) ?? null
  const width = Math.max(900, ...[...pos.values()].map((p) => p.x + W + 60))
  const height = Math.max(600, ...[...pos.values()].map((p) => p.y + H + 80))

  const addNode = (type: string) => {
    const nid = newId(nodes)
    const node: FlowNode = { id: nid, type, data: defaults(type) }
    let list = [...nodes, node]
    if (selected) {
      const o = outs(selected).find((x) => !x.target)
      if (o) list = list.map((n) => n.id !== selected.id ? n : o.key === 'next' ? { ...n, next: nid } : { ...n, branches: { ...n.branches, [o.key]: nid } })
    }
    update({ ...flow, nodes: list }); setSel(nid); setAdding(false)
  }
  const save = async (extra: Partial<Flow> = {}) => {
    setBusy(true)
    try { const f = await put<Flow>(`flows/${flow.id}`, { name: flow.name, description: flow.description ?? '', trigger: flow.trigger, nodes: flow.nodes, ...extra }); setFlow({ ...flow, ...extra, is_active: f.is_active }); setDirty(false); t.ok('Flow saved') }
    catch (e) { t.err(e) } finally { setBusy(false) }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-3">
        <Link to="/app/flows" className="text-muted hover:text-white"><ArrowLeft className="size-5" /></Link>
        <input value={flow.name} onChange={(e) => update({ ...flow, name: e.target.value })} className="min-w-40 flex-1 bg-transparent font-display text-lg font-semibold text-white outline-none sm:flex-none" />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Trigger</span>
          <Select className="!h-9 w-40 text-xs" value={flow.trigger.type} onChange={(e) => update({ ...flow, trigger: { ...flow.trigger, type: e.target.value } })}>
            <option value="keyword">Keyword</option><option value="new_contact">New contact</option><option value="any_message">Any message</option><option value="tag_added">Tag added</option><option value="api">API / manual only</option>
          </Select>
          {flow.trigger.type === 'keyword' && <><Select className="!h-9 w-28 text-xs" value={flow.trigger.match ?? 'exact'} onChange={(e) => update({ ...flow, trigger: { ...flow.trigger, match: e.target.value } })}><option value="exact">is</option><option value="contains">contains</option><option value="starts">starts with</option></Select>
            <Input className="!h-9 w-48 text-xs" placeholder="hi, hello, offer" value={flow.trigger.value ?? ''} onChange={(e) => update({ ...flow, trigger: { ...flow.trigger, value: e.target.value } })} /></>}
          {flow.trigger.type === 'tag_added' && <Input className="!h-9 w-40 text-xs" placeholder="tag name" value={flow.trigger.value ?? ''} onChange={(e) => update({ ...flow, trigger: { ...flow.trigger, value: e.target.value } })} />}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Toggle checked={!!flow.is_active} label={<span className="hidden sm:inline">{flow.is_active ? 'Live' : 'Off'}</span>} onChange={(v) => save({ is_active: v ? 1 : 0 } as Partial<Flow>)} />
          <Button size="sm" variant="ghost" icon={<History className="size-4" />} onClick={() => setRunsOpen(true)}><span className="hidden md:inline">Runs</span></Button>
          <Button size="sm" variant="subtle" icon={<Play className="size-4" />} onClick={() => setTestOpen(true)}>Test</Button>
          <Button size="sm" loading={busy} disabled={!dirty} icon={<Save className="size-4" />} onClick={() => save()}>Save</Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 overflow-auto bg-ink grid-bg">
          <svg width={width} height={height} className="absolute left-0 top-0">
            <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#34d399" /></marker></defs>
            {nodes.flatMap((n) => {
              const a = pos.get(n.id)!
              const os = outs(n).filter((o) => o.target && pos.has(o.target))
              return os.map((o, i) => {
                const b = pos.get(o.target!)!
                const x1 = a.x + (W / (os.length + 1)) * (i + 1), y1 = a.y + H, x2 = b.x + W / 2, y2 = b.y
                const back = y2 <= y1
                const d = back ? `M${x1},${y1} C${x1},${y1 + 60} ${a.x + W + 60},${y1 + 40} ${a.x + W + 40},${(y1 + y2) / 2} S${x2},${y2 - 60} ${x2},${y2}` : `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`
                return <g key={`${n.id}-${o.key}`}>
                  <path d={d} fill="none" stroke="#34d399" strokeOpacity=".55" strokeWidth="1.6" markerEnd="url(#arr)" />
                  {os.length > 1 && <text x={x1} y={y1 + 13 + (i % 2) * 11} textAnchor="middle" fontSize="9" fill="#8a9aa3">{o.label.slice(0, 9)}</text>}
                </g>
              })
            })}
          </svg>
          <div className="relative" style={{ width, height }}>
            {nodes.map((n, i) => {
              const p = pos.get(n.id)!
              const T = TYPES[n.type] ?? TYPES.end
              return (
                <button key={n.id} onClick={() => setSel(n.id)} style={{ left: p.x, top: p.y, width: W, height: H }}
                  className={cx('absolute flex flex-col rounded-2xl border bg-card p-3 text-left shadow-lg transition', sel === n.id ? 'border-brand ring-2 ring-brand/30' : 'border-line-strong hover:border-brand/50')}>
                  <div className="flex items-center gap-2">
                    <span className={cx('grid size-7 place-items-center rounded-lg', T.color)}><T.icon className="size-3.5" /></span>
                    <span className="text-xs font-semibold text-white">{T.label}</span>
                    {i === 0 && <Badge tone="blue" className="ml-auto">Start</Badge>}
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-snug text-muted">{summary(n) || '—'}</p>
                </button>
              )
            })}
          </div>
          <div className="fixed bottom-6 left-1/2 z-10 -translate-x-1/2 lg:absolute">
            {adding && <div className="mb-2 grid w-[min(92vw,520px)] grid-cols-2 gap-1.5 rounded-2xl border border-line-strong bg-panel p-2 shadow-2xl sm:grid-cols-3">
              {Object.entries(TYPES).map(([k, v]) => <button key={k} onClick={() => addNode(k)} className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs text-soft hover:bg-white/5"><span className={cx('grid size-7 place-items-center rounded-lg', v.color)}><v.icon className="size-3.5" /></span>{v.label}</button>)}
            </div>}
            <Button className="mx-auto flex" icon={<Plus className="size-4" />} onClick={() => setAdding(!adding)}>Add step{selected && outs(selected).some((o) => !o.target) ? ' after selected' : ''}</Button>
          </div>
        </div>
        {selected && (
          <aside className="w-full max-w-md shrink-0 overflow-y-auto border-l border-line bg-panel p-5 max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40">
            <button className="mb-3 text-xs text-muted hover:text-white lg:hidden" onClick={() => setSel(null)}>← Back to canvas</button>
            <Inspector key={selected.id} node={selected} nodes={nodes} isStart={nodes[0]?.id === selected.id} members={team?.members ?? []} sequences={seqs ?? []}
              onChange={(nn) => update({ ...flow, nodes: nodes.map((x) => (x.id === nn.id ? nn : x)) })}
              onStart={() => update({ ...flow, nodes: [selected, ...nodes.filter((x) => x.id !== selected.id)] })}
              onDelete={() => {
                const rest = nodes.filter((x) => x.id !== selected.id).map((x) => ({ ...x, next: x.next === selected.id ? null : x.next, branches: x.branches && Object.fromEntries(Object.entries(x.branches).map(([k, v]) => [k, v === selected.id ? null : v])) }))
                update({ ...flow, nodes: rest }); setSel(rest[0]?.id ?? null)
              }} />
          </aside>
        )}
      </div>
      <TestModal open={testOpen} onClose={() => setTestOpen(false)} flowId={flow.id} dirty={dirty} />
      <RunsModal open={runsOpen} onClose={() => setRunsOpen(false)} flowId={flow.id} />
    </div>
  )
}

function TestModal({ open, onClose, flowId, dirty }: { open: boolean; onClose: () => void; flowId: number; dirty: boolean }) {
  const t = useToast()
  const [q, setQ] = useState('')
  const { data } = useApi<{ data: Contact[] }>(open ? `contacts?limit=20&q=${encodeURIComponent(q)}` : null)
  return (
    <Modal open={open} onClose={onClose} title="Test flow on a contact">
      {dirty && <p className="mb-3 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200">Save your changes first — the test runs the saved version.</p>}
      <Input placeholder="Search contact" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {data?.data.map((c) => <button key={c.id} className="flex w-full justify-between px-3 py-2.5 text-left text-sm hover:bg-white/5" onClick={async () => {
          try { await post(`flows/${flowId}/test`, { contact_id: c.id }); t.ok('Flow started — open the inbox to follow along'); onClose() } catch (e) { t.err(e) }
        }}><span className="text-white">{c.name || '—'}</span><span className="text-muted">{phone(c.wa_id)}</span></button>)}
      </div>
      <p className="mt-3 text-xs text-muted">Tip: use the inbox simulator (sandbox number) to reply as the customer.</p>
    </Modal>
  )
}

function RunsModal({ open, onClose, flowId }: { open: boolean; onClose: () => void; flowId: number }) {
  const { data } = useApi<{ id: number; name: string; wa_id: string; status: string; current_node: string | null; state: Record<string, unknown>; created_at: string }[]>(open ? `flows/${flowId}/runs` : null)
  return (
    <Modal open={open} onClose={onClose} title="Recent runs" wide>
      <Table head={['Contact', 'Status', 'Captured data', 'Started']}>
        {data?.map((r) => <tr key={r.id}><Td><div className="text-white">{r.name || '—'}</div><div className="text-xs text-muted">{phone(r.wa_id)}</div></Td><Td><Badge tone={statusTone(r.status)}>{r.status}</Badge></Td>
          <Td className="max-w-72 truncate text-xs">{Object.entries(r.state).filter(([k]) => k !== 'trigger_text').map(([k, v]) => `${k}: ${typeof v === 'object' ? '…' : v}`).join(' · ')}</Td><Td className="text-xs">{dateTime(r.created_at)}</Td></tr>)}
      </Table>
      {data?.length === 0 && <p className="py-6 text-center text-sm text-muted">No runs yet.</p>}
    </Modal>
  )
}
