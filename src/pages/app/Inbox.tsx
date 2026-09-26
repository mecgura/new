import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Search, Send, Paperclip, Sparkles, Check, CheckCheck, Clock, AlertCircle, UserPlus, CheckCircle2, RotateCcw, PauseCircle, PlayCircle,
  FileText, MessageSquarePlus, ArrowLeft, Zap, ShoppingBag, IndianRupee, StickyNote, Phone, Mail, FlaskConical, Info, X, Image as ImageIcon,
} from 'lucide-react'
import { get, post, patch, api } from '../../lib/api'
import { useApi, useEvents, useDebounced, useNow } from '../../lib/hooks'
import { useSession } from '../../lib/session'
import { ago, time, phone, dateTime, inr, titleCase } from '../../lib/format'
import { Avatar, Badge, Button, Input, Select, Textarea, Modal, Field, useToast, cx, statusTone, Spinner, Empty, TagInput } from '../../components/ui'
import { TemplatePreview } from '../../components/WhatsAppPreview'
import type { Conversation, Message, Template, Contact, Member, WaNumber } from '../../lib/types'

type ConvDetail = Conversation & { contact: Contact; notes: { id: number; body: string; user_name: string; created_at: string }[]; orders: { id: number; total: number; status: string; payment_status: string; created_at: string }[]; display_phone: string | null }

const Tick = ({ s }: { s: string }) => s === 'read' ? <CheckCheck className="size-3.5 text-sky-300" /> : s === 'delivered' ? <CheckCheck className="size-3.5" /> : s === 'sent' ? <Check className="size-3.5" />
  : s === 'failed' ? <AlertCircle className="size-3.5 text-red-300" /> : <Clock className="size-3" />

const senderLabel: Record<string, string> = { bot: 'Chatbot', flow: 'Flow', ai: 'AI', campaign: 'Campaign', api: 'API', sequence: 'Follow-up', system: 'System' }

function Bubble({ m }: { m: Message }) {
  const out = m.direction === 'out'
  const p = m.payload as { buttons?: { title: string }[]; sections?: { rows: { title: string }[] }[]; display_text?: string; link?: string; media_id?: string; type?: string; button?: string }
  const isMedia = ['image', 'video', 'document', 'audio', 'sticker'].includes(m.type)
  return (
    <div className={cx('flex', out ? 'justify-end' : 'justify-start')}>
      <div className="max-w-[78%] sm:max-w-[65%]">
        <div className={cx('rounded-xl px-3 py-2 text-[13.5px] leading-snug shadow-sm', out ? 'rounded-tr-sm bg-[#005c4b] text-[#e9edef]' : 'rounded-tl-sm bg-[#1f2c33] text-[#e9edef]')}>
          {out && m.sent_by && m.sent_by !== 'agent' && <div className="mb-0.5 text-[10.5px] font-semibold text-[#8fd6c4]">{senderLabel[m.sent_by] ?? m.sent_by}</div>}
          {out && m.sent_by === 'agent' && m.agent_name && <div className="mb-0.5 text-[10.5px] font-semibold text-[#8fd6c4]">{m.agent_name}</div>}
          {isMedia && (
            m.type === 'image' && (p.link || p.media_id) ? <MediaImage m={m} /> :
              <div className="mb-1 flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-2 text-xs"><FileText className="size-4" />{m.type}</div>
          )}
          {m.type === 'template' && <div className="mb-1 flex items-center gap-1 text-[10.5px] text-[#8fd6c4]"><FileText className="size-3" />Template</div>}
          <div className="whitespace-pre-wrap break-words">{m.body}</div>
          <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[#8696a0]">{time(m.created_at)}{out && <Tick s={m.status} />}</div>
        </div>
        {out && p.buttons?.map((b) => <div key={b.title} className="mt-0.5 rounded-lg bg-[#005c4b]/70 py-1.5 text-center text-[12.5px] text-sky-300">{b.title}</div>)}
        {out && p.type === 'list' && <div className="mt-0.5 rounded-lg bg-[#005c4b]/70 py-1.5 text-center text-[12.5px] text-sky-300">☰ {p.button}</div>}
        {out && p.display_text && <div className="mt-0.5 rounded-lg bg-[#005c4b]/70 py-1.5 text-center text-[12.5px] text-sky-300">↗ {p.display_text}</div>}
        {m.status === 'failed' && m.error && <div className="mt-1 text-right text-[11px] text-red-300">{m.error}</div>}
      </div>
    </div>
  )
}

function MediaImage({ m }: { m: Message }) {
  const p = m.payload as { link?: string; media_id?: string }
  const [src, setSrc] = useState<string | null>(p.link ?? null)
  useEffect(() => {
    if (p.link || !p.media_id) return
    let url = ''
    api<Response>(`media/${m.id}`, { raw: true }).then(async (r) => { if (r.ok) { url = URL.createObjectURL(await r.blob()); setSrc(url) } }).catch(() => undefined)
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [m.id, p.link, p.media_id])
  return src ? <img src={src} alt="" className="mb-1 max-h-64 rounded-lg object-cover" /> : <div className="mb-1 grid h-32 w-48 place-items-center rounded-lg bg-black/20"><ImageIcon className="size-5 text-muted" /></div>
}

function TemplateModal({ open, onClose, onSend, title = 'Send template' }: { open: boolean; onClose: () => void; onSend: (templateId: number, vars: { body: string[]; header_media?: string }) => Promise<void>; title?: string }) {
  const { data: templates } = useApi<Template[]>(open ? 'templates?status=APPROVED' : null)
  const [tid, setTid] = useState<number | null>(null)
  const [vars, setVars] = useState<string[]>([])
  const [media, setMedia] = useState('')
  const [busy, setBusy] = useState(false)
  const t = templates?.find((x) => x.id === tid)
  const count = t ? new Set((t.components.find((c) => c.type === 'BODY')?.text ?? '').match(/\{\{\d+\}\}/g) ?? []).size : 0
  const header = t?.components.find((c) => c.type === 'HEADER')
  return (
    <Modal open={open} onClose={onClose} title={title} wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!t} loading={busy} onClick={async () => { setBusy(true); try { await onSend(t!.id, { body: vars.slice(0, count), header_media: media || undefined }); onClose() } finally { setBusy(false) } }}>Send</Button></>}>
      {templates && templates.length === 0 ? <Empty title="No approved templates" text="Create a template and wait for Meta approval." action={<Link to="/app/templates"><Button>Create template</Button></Link>} /> : (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <Field label="Template"><Select value={tid ?? ''} onChange={(e) => { setTid(Number(e.target.value)); setVars([]) }}>
              <option value="">Select an approved template…</option>{templates?.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.language}) · {x.category.toLowerCase()}</option>)}
            </Select></Field>
            {header && header.format && header.format !== 'TEXT' && <Field label={`Header ${header.format.toLowerCase()} URL`}><Input value={media} onChange={(e) => setMedia(e.target.value)} placeholder="https://…" /></Field>}
            {[...Array(count)].map((_, i) => <Field key={i} label={`Variable {{${i + 1}}}`} hint={i === 0 ? 'Use {{name}} or {{first_name}} to personalise' : undefined}>
              <Input value={vars[i] ?? ''} onChange={(e) => { const v = [...vars]; v[i] = e.target.value; setVars(v) }} /></Field>)}
          </div>
          {t && <TemplatePreview components={t.components} vars={vars} />}
        </div>
      )}
    </Modal>
  )
}

function NewChat({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: (convId?: number) => void }) {
  const [f, setF] = useState({ phone: '', name: '' })
  const [step, setStep] = useState(0)
  const t = useToast()
  return <>
    <Modal open={open && step === 0} onClose={onClose} title="Start a new conversation" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={f.phone.replace(/\D/g, '').length < 10} onClick={() => setStep(1)}>Choose template</Button></>}>
      <p className="mb-4 text-sm text-muted">WhatsApp requires an approved template to start a conversation. Once the customer replies you can chat freely for 24 hours.</p>
      <div className="space-y-4">
        <Field label="WhatsApp number" hint="With country code, e.g. 91 98765 43210"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Name (optional)"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      </div>
    </Modal>
    <TemplateModal open={open && step === 1} title="Choose opening template" onClose={() => { setStep(0); onClose() }} onSend={async (template_id, vars) => {
      try { await post('conversations/start', { phone: f.phone, name: f.name || undefined, template_id, vars }); t.ok('Message sent'); setStep(0); setF({ phone: '', name: '' }); onStarted() }
      catch (e) { t.err(e); throw e }
    }} />
  </>
}

function Simulator({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (convId?: number) => void }) {
  const [f, setF] = useState({ phone: '919999900001', name: 'Test Customer', text: 'hi' })
  const [busy, setBusy] = useState(false)
  const t = useToast()
  return (
    <Modal open={open} onClose={onClose} title="Simulate incoming message" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={busy} onClick={async () => {
      setBusy(true)
      try { const r = await post<{ conversation_id?: number }>('simulate', f); t.ok('Message received — automations ran'); onDone(r.conversation_id) } catch (e) { t.err(e) } finally { setBusy(false) }
    }}>Send as customer</Button></>}>
      <p className="mb-4 text-sm text-muted">Test your chatbot, flows and AI without a real phone. The message is processed exactly like a real WhatsApp message.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Customer number"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Customer name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      </div>
      <Field label="Message" className="mt-4"><Textarea rows={3} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
    </Modal>
  )
}

function ContactPanel({ conv, members, onChange, onClose }: { conv: ConvDetail; members: Member[]; onChange: () => void; onClose: () => void }) {
  const t = useToast()
  const [note, setNote] = useState('')
  const c = conv.contact
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b border-line px-4 py-3 xl:hidden"><span className="text-sm font-semibold text-white">Contact</span><button onClick={onClose}><X className="size-5 text-muted" /></button></div>
      <div className="border-b border-line p-5 text-center">
        <Avatar name={c.name || c.wa_id} className="mx-auto size-14 text-base" />
        <div className="mt-3 font-display font-semibold text-white">{c.name || phone(c.wa_id)}</div>
        <div className="mt-1 flex items-center justify-center gap-1.5 text-xs text-muted"><Phone className="size-3" />{phone(c.wa_id)}</div>
        {c.email && <div className="mt-0.5 flex items-center justify-center gap-1.5 text-xs text-muted"><Mail className="size-3" />{c.email}</div>}
        {c.opted_out ? <Badge tone="red" className="mt-2">Opted out</Badge> : null}
      </div>
      <div className="space-y-5 p-4">
        <Field label="Assigned to">
          <Select value={conv.assigned_to ?? ''} onChange={async (e) => { try { await patch(`conversations/${conv.id}`, { assigned_to: e.target.value ? Number(e.target.value) : null }); onChange() } catch (er) { t.err(er) } }}>
            <option value="">Unassigned</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
          </Select>
        </Field>
        <Field label="Lead stage">
          <Select value={c.stage} onChange={async (e) => { await patch(`contacts/${c.id}`, { stage: e.target.value }); onChange() }}>
            {['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select>
        </Field>
        <Field label="Tags"><TagInput value={conv.contact.tags} onChange={async (v) => { try { await patch(`contacts/${c.id}`, { tags: v }); onChange() } catch (er) { t.err(er) } }} /></Field>
        {Object.keys(c.attributes).length > 0 && (
          <div><div className="mb-1.5 text-xs font-medium text-soft">Details</div>
            <div className="space-y-1 rounded-xl border border-line bg-panel p-3 text-xs">{Object.entries(c.attributes).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><span className="text-muted">{titleCase(k)}</span><span className="truncate text-right text-white">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span></div>)}</div>
          </div>
        )}
        {conv.orders.length > 0 && <div><div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-soft"><ShoppingBag className="size-3.5" />Orders</div>
          {conv.orders.map((o) => <div key={o.id} className="mb-1.5 flex justify-between rounded-lg border border-line bg-panel px-3 py-2 text-xs"><span className="text-white">#{o.id} · {inr(o.total)}</span><Badge tone={statusTone(o.payment_status === 'paid' ? 'paid' : o.status)}>{o.payment_status === 'paid' ? 'paid' : o.status}</Badge></div>)}
        </div>}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-soft"><StickyNote className="size-3.5" />Internal notes</div>
          <form onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await post(`contacts/${c.id}/notes`, { body: note }); setNote(''); onChange() }}>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only your team can see this" />
            <Button size="sm" variant="subtle" className="mt-2">Add note</Button>
          </form>
          <div className="mt-3 space-y-2">{conv.notes.map((n) => <div key={n.id} className="rounded-lg border border-amber-400/15 bg-amber-400/5 p-2.5 text-xs"><div className="whitespace-pre-wrap text-soft">{n.body}</div><div className="mt-1 text-[10px] text-muted">{n.user_name} · {dateTime(n.created_at)}</div></div>)}</div>
        </div>
        <Link to={`/app/contacts?open=${c.id}`} className="block text-center text-xs text-brand-2">Open full contact profile →</Link>
      </div>
    </div>
  )
}

export default function Inbox() {
  const { can, user } = useSession()
  const t = useToast()
  const [params, setParams] = useSearchParams()
  const activeId = Number(params.get('c')) || null
  const [filter, setFilter] = useState({ status: 'open', assigned: 'all', number_id: '', q: '' })
  const q = useDebounced(filter.q)
  const qs = new URLSearchParams({ status: filter.status, assigned: filter.assigned, ...(filter.number_id ? { number_id: filter.number_id } : {}), ...(q ? { q } : {}) }).toString()
  const { data: convs, reload: reloadList, setData: setConvs } = useApi<Conversation[]>(`conversations?${qs}`)
  const { data: numbers } = useApi<WaNumber[]>('numbers')
  const { data: team } = useApi<{ members: Member[] }>('team')
  const { data: quick } = useApi<{ id: number; shortcut: string; body: string }[]>('quick-replies')
  const [loaded, setDetail] = useState<ConvDetail | null>(null)
  const detail = loaded && loaded.id === activeId ? loaded : null
  const [thread, setThread] = useState<{ id: number | null; msgs: Message[] }>({ id: null, msgs: [] })
  const msgs = thread.id === activeId ? thread.msgs : []
  const loadingMsgs = !!activeId && thread.id !== activeId
  const setMsgs = (fn: (m: Message[]) => Message[]) => setThread((th) => ({ ...th, msgs: fn(th.msgs) }))
  const now = useNow(30000)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [modal, setModal] = useState<'' | 'template' | 'new' | 'sim' | 'product' | 'payment' | 'buttons'>('')
  const [showInfo, setShowInfo] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const loadDetail = async (id: number) => { try { setDetail(await get<ConvDetail>(`conversations/${id}`)) } catch (e) { t.err(e) } }
  useEffect(() => {
    if (!activeId) return
    get<ConvDetail>(`conversations/${activeId}`).then(setDetail).catch((e) => { t.err(e); setParams({}) })
    get<Message[]>(`conversations/${activeId}/messages`).then((m) => setThread({ id: activeId, msgs: m })).catch(() => undefined)
    void post(`conversations/${activeId}/read`).catch(() => undefined).then(() => setConvs((x) => x?.map((c) => (c.id === activeId ? { ...c, unread_count: 0 } : c)) ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs.length, activeId])

  useEvents((type, d) => {
    if (type === 'message') {
      const { conversation_id, message } = d as { conversation_id: number; message: Message }
      if (conversation_id === activeId) {
        setMsgs((x) => (x.some((m) => m.id === message.id) ? x : [...x, message]))
        if (message.direction === 'in') void post(`conversations/${activeId}/read`)
      }
      void reloadList()
    } else if (type === 'status') {
      const s = d as { message_id: number; status: string; error?: string }
      setMsgs((x) => x.map((m) => (m.id === s.message_id ? { ...m, status: s.status, error: s.error ?? m.error } : m)))
    } else if (type === 'conversation') {
      void reloadList()
      if ((d as { id: number }).id === activeId && activeId) void loadDetail(activeId)
    }
  })

  const windowOpen = detail?.last_inbound_at ? now - new Date(detail.last_inbound_at).getTime() < 86400000 : false
  const isDemo = numbers?.find((n) => n.id === detail?.number_id)?.is_demo
  const canFreeText = windowOpen || !!isDemo
  const hoursLeft = detail?.last_inbound_at ? Math.max(0, 24 - (now - new Date(detail.last_inbound_at).getTime()) / 3600000) : 0

  const send = async (body: Record<string, unknown>) => {
    if (!activeId) return
    setSending(true)
    try {
      const m = await post<Message>(`conversations/${activeId}/messages`, body)
      setMsgs((x) => (x.some((y) => y.id === m.id) ? x : [...x, m]))
      if (m.status === 'failed') t.err(m.error || 'Message failed')
    } catch (e) { t.err(e); throw e } finally { setSending(false) }
  }
  const sendText = async () => { const v = text.trim(); if (!v) return; setText(''); try { await send({ type: 'text', text: v }) } catch { setText(v) } }
  const qMatches = useMemo(() => (text.startsWith('/') ? (quick ?? []).filter((r) => r.shortcut.startsWith(text.slice(1).toLowerCase())) : []), [text, quick])

  const setStatus = async (body: Record<string, unknown>) => { if (!activeId) return; try { await patch(`conversations/${activeId}`, body); await loadDetail(activeId); void reloadList() } catch (e) { t.err(e) } }

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className={cx('flex w-full shrink-0 flex-col border-r border-line bg-panel md:w-[340px]', !!activeId && 'max-md:hidden')}>
        <div className="space-y-2.5 border-b border-line p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input className="pl-9" placeholder="Search name, number, message" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} /></div>
            {can('inbox.reply') && <Button size="sm" className="h-10 w-10 !px-0" title="New chat" onClick={() => setModal('new')}><MessageSquarePlus className="size-4" /></Button>}
          </div>
          <div className="flex gap-2">
            <Select className="!h-8 text-xs" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="open">Open</option><option value="pending">Pending</option><option value="resolved">Resolved</option><option value="all">All</option>
            </Select>
            <Select className="!h-8 text-xs" value={filter.assigned} onChange={(e) => setFilter({ ...filter, assigned: e.target.value })}>
              <option value="all">Everyone</option><option value="me">Mine</option><option value="unassigned">Unassigned</option>
              {team?.members.filter((m) => m.user_id !== user?.id).map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </Select>
            {(numbers?.length ?? 0) > 1 && <Select className="!h-8 text-xs" value={filter.number_id} onChange={(e) => setFilter({ ...filter, number_id: e.target.value })}>
              <option value="">All numbers</option>{numbers?.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </Select>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!convs ? <div className="grid place-items-center py-10"><Spinner /></div> : convs.length === 0 ? (
            <Empty title="No conversations" text={numbers?.length ? 'New WhatsApp messages will appear here instantly.' : 'Connect a WhatsApp number to start receiving messages.'}
              action={numbers?.length ? <Button variant="subtle" size="sm" icon={<FlaskConical className="size-4" />} onClick={() => setModal('sim')}>Simulate a message</Button> : <Link to="/app/numbers"><Button size="sm">Connect number</Button></Link>} />
          ) : convs.map((c) => (
            <button key={c.id} onClick={() => setParams({ c: String(c.id) })} className={cx('flex w-full gap-3 border-b border-line/50 px-3 py-3 text-left transition', c.id === activeId ? 'bg-brand/10' : 'hover:bg-white/[.03]')}>
              <Avatar name={c.contact_name || c.wa_id} className="size-10 text-xs" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-medium text-white">{c.contact_name || phone(c.wa_id)}</span><span className={cx('shrink-0 text-[11px]', c.unread_count ? 'text-brand-2' : 'text-muted')}>{ago(c.last_message_at)}</span></div>
                <div className="flex items-center justify-between gap-2"><span className="truncate text-xs text-muted">{c.last_preview}</span>{c.unread_count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-ink">{c.unread_count}</span>}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.agent_name ? <span className="text-[10px] text-muted">→ {c.agent_name}</span> : <span className="text-[10px] text-amber-300/80">Unassigned</span>}
                  {c.bot_paused ? <span className="text-[10px] text-rose-300/80">· needs human</span> : null}
                  {c.tags.slice(0, 2).map((tg) => <span key={tg} className="rounded bg-white/5 px-1 text-[10px] text-soft">{tg}</span>)}
                </div>
              </div>
            </button>
          ))}
        </div>
        {(numbers?.length ?? 0) > 0 && <button onClick={() => setModal('sim')} className="flex items-center justify-center gap-2 border-t border-line py-2.5 text-xs text-muted hover:text-white"><FlaskConical className="size-3.5" />Test with simulator</button>}
      </div>

      {/* Chat */}
      {!activeId || !detail ? (
        <div className="hidden flex-1 place-items-center md:grid"><Empty title="Select a conversation" text="Pick a chat from the list, or start a new one with a template." icon={<Send className="size-5" />} /></div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 sm:px-4">
            <button className="md:hidden" onClick={() => setParams({})}><ArrowLeft className="size-5 text-soft" /></button>
            <Avatar name={detail.contact.name || detail.contact.wa_id} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-white">{detail.contact.name || phone(detail.contact.wa_id)}</div>
              <div className="flex items-center gap-2 text-[11px] text-muted"><span>{phone(detail.contact.wa_id)}</span>{detail.number_label && <span className="hidden sm:inline">· via {detail.number_label}</span>}</div>
            </div>
            <div className="flex items-center gap-1.5">
              {detail.bot_paused
                ? <Button size="sm" variant="subtle" icon={<PlayCircle className="size-4" />} onClick={() => setStatus({ bot_paused: false })} title="Let bots/AI reply again"><span className="hidden lg:inline">Resume bot</span></Button>
                : <Button size="sm" variant="subtle" icon={<PauseCircle className="size-4" />} onClick={() => setStatus({ bot_paused: true })} title="Stop bots/AI for this chat"><span className="hidden lg:inline">Pause bot</span></Button>}
              {!detail.assigned_to && <Button size="sm" variant="subtle" icon={<UserPlus className="size-4" />} onClick={() => setStatus({ assigned_to: user?.id })}><span className="hidden lg:inline">Assign me</span></Button>}
              {detail.status !== 'resolved'
                ? <Button size="sm" icon={<CheckCircle2 className="size-4" />} onClick={() => setStatus({ status: 'resolved' })}><span className="hidden sm:inline">Resolve</span></Button>
                : <Button size="sm" variant="outline" icon={<RotateCcw className="size-4" />} onClick={() => setStatus({ status: 'open' })}><span className="hidden sm:inline">Reopen</span></Button>}
              <Button size="sm" variant="ghost" className="xl:hidden" onClick={() => setShowInfo(true)}><Info className="size-4" /></Button>
            </div>
          </div>

          <div className="wa-bg flex-1 space-y-2 overflow-y-auto px-3 py-4 sm:px-6">
            {loadingMsgs ? <div className="grid place-items-center py-10"><Spinner /></div> : msgs.map((m) => <Bubble key={m.id} m={m} />)}
            <div ref={endRef} />
          </div>

          <div className="shrink-0 border-t border-line bg-panel p-3">
            {!can('inbox.reply') ? <p className="py-2 text-center text-sm text-muted">You have view-only access.</p> : !canFreeText ? (
              <div className="flex flex-col items-center gap-3 py-2 text-center sm:flex-row sm:justify-between sm:text-left">
                <p className="text-sm text-muted"><Clock className="mr-1 inline size-4 text-amber-300" />The 24-hour reply window is closed. Send an approved template to re-open the conversation.</p>
                <Button icon={<FileText className="size-4" />} onClick={() => setModal('template')}>Send template</Button>
              </div>
            ) : <>
              {qMatches.length > 0 && <div className="mb-2 max-h-40 overflow-y-auto rounded-xl border border-line bg-card">
                {qMatches.map((r) => <button key={r.id} onClick={() => setText(r.body)} className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5"><b className="text-brand-2">/{r.shortcut}</b> <span className="text-muted">{r.body.slice(0, 80)}</span></button>)}
              </div>}
              <div className="flex items-end gap-2">
                <div className="flex gap-0.5 pb-1">
                  <button title="Attach file" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white" onClick={() => fileRef.current?.click()}><Paperclip className="size-[18px]" /></button>
                  <button title="Template" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white" onClick={() => setModal('template')}><FileText className="size-[18px]" /></button>
                  <button title="Quick reply buttons" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white max-sm:hidden" onClick={() => setModal('buttons')}><Zap className="size-[18px]" /></button>
                  <button title="Send product" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white max-sm:hidden" onClick={() => setModal('product')}><ShoppingBag className="size-[18px]" /></button>
                  <button title="Payment link" className="rounded-lg p-2 text-muted hover:bg-white/5 hover:text-white max-sm:hidden" onClick={() => setModal('payment')}><IndianRupee className="size-[18px]" /></button>
                </div>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Type a message · / for quick replies"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendText() } }}
                  className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-line bg-ink px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-muted/70 focus:border-brand/50" />
                <Button variant="subtle" className="h-10 w-10 !px-0" title="AI suggest reply" loading={aiBusy} onClick={async () => {
                  setAiBusy(true)
                  try { setText((await post<{ text: string }>(`conversations/${activeId}/ai-suggest`)).text) } catch (e) { t.err(e) } finally { setAiBusy(false) }
                }}>{!aiBusy && <Sparkles className="size-4 text-brand-2" />}</Button>
                <Button className="h-10 w-10 !px-0" onClick={sendText} loading={sending} disabled={!text.trim()}>{!sending && <Send className="size-4" />}</Button>
              </div>
              <div className="mt-1.5 flex justify-between px-1 text-[11px] text-muted">
                <span>{isDemo ? 'Sandbox number — messages are simulated' : `Reply window closes in ${Math.floor(hoursLeft)}h ${Math.round((hoursLeft % 1) * 60)}m`}</span>
                <span className="hidden sm:inline">Shift + Enter for new line</span>
              </div>
            </>}
            <input ref={fileRef} type="file" hidden onChange={async (e) => {
              const file = e.target.files?.[0]; e.target.value = ''
              if (!file) return
              const fd = new FormData(); fd.append('file', file)
              try {
                const up = await api<{ url: string; mime: string; name: string }>('uploads', { method: 'POST', body: fd })
                const kind = up.mime.startsWith('image/') ? 'image' : up.mime.startsWith('video/') ? 'video' : up.mime.startsWith('audio/') ? 'audio' : 'document'
                await send({ type: kind, link: up.url, filename: up.name, caption: text || undefined }); setText('')
              } catch (er) { t.err(er) }
            }} />
          </div>
        </div>
      )}

      {detail && (
        <>
          <aside className="hidden w-80 shrink-0 border-l border-line bg-panel xl:block"><ContactPanel conv={detail} members={team?.members ?? []} onChange={() => loadDetail(detail.id)} onClose={() => undefined} /></aside>
          {showInfo && <div className="fixed inset-0 z-40 flex justify-end bg-black/60 xl:hidden" onClick={() => setShowInfo(false)}>
            <div className="h-full w-80 max-w-full border-l border-line bg-panel" onClick={(e) => e.stopPropagation()}><ContactPanel conv={detail} members={team?.members ?? []} onChange={() => loadDetail(detail.id)} onClose={() => setShowInfo(false)} /></div>
          </div>}
        </>
      )}

      <TemplateModal open={modal === 'template'} onClose={() => setModal('')} onSend={(template_id, vars) => send({ type: 'template', template_id, vars })} />
      <NewChat open={modal === 'new'} onClose={() => setModal('')} onStarted={() => { setModal(''); setFilter({ ...filter, status: 'all' }); void reloadList() }} />
      <Simulator open={modal === 'sim'} onClose={() => setModal('')} onDone={(cid) => { void reloadList(); if (cid) setParams({ c: String(cid) }) }} />
      <ButtonsModal open={modal === 'buttons'} onClose={() => setModal('')} onSend={(b) => send(b)} />
      <ProductModal open={modal === 'product'} onClose={() => setModal('')} onSend={(pid) => send({ type: 'product', product_id: pid })} />
      <PaymentModal open={modal === 'payment'} onClose={() => setModal('')} onSend={(amount, description) => send({ type: 'payment', amount, description })} />
    </div>
  )
}

function ButtonsModal({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (b: Record<string, unknown>) => Promise<void> }) {
  const [text, setText] = useState('')
  const [btns, setBtns] = useState(['Yes', 'No', ''])
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} onClose={onClose} title="Send quick reply buttons" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!text || !btns.some(Boolean)} onClick={async () => { setBusy(true); try { await onSend({ type: 'buttons', text, buttons: btns.filter(Boolean) }); onClose() } finally { setBusy(false) } }}>Send</Button></>}>
      <Field label="Message"><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="mt-4 grid grid-cols-3 gap-2">{btns.map((b, i) => <Input key={i} maxLength={20} placeholder={`Button ${i + 1}`} value={b} onChange={(e) => setBtns(btns.map((x, j) => (j === i ? e.target.value : x)))} />)}</div>
    </Modal>
  )
}

function ProductModal({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (id: number) => Promise<void> }) {
  const { data } = useApi<{ id: number; name: string; price: number; image_url: string | null; is_active: number }[]>(open ? 'products' : null)
  return (
    <Modal open={open} onClose={onClose} title="Send a product">
      {data?.length === 0 && <Empty title="No products yet" action={<Link to="/app/commerce"><Button size="sm">Add products</Button></Link>} />}
      <div className="grid gap-2 sm:grid-cols-2">{data?.filter((p) => p.is_active).map((p) => (
        <button key={p.id} onClick={async () => { await onSend(p.id); onClose() }} className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3 text-left hover:border-brand/50">
          {p.image_url ? <img src={p.image_url} alt="" className="size-12 rounded-lg object-cover" /> : <div className="grid size-12 place-items-center rounded-lg bg-raised"><ShoppingBag className="size-5 text-muted" /></div>}
          <div className="min-w-0"><div className="truncate text-sm font-medium text-white">{p.name}</div><div className="text-xs text-brand-2">{inr(p.price)}</div></div>
        </button>
      ))}</div>
    </Modal>
  )
}

function PaymentModal({ open, onClose, onSend }: { open: boolean; onClose: () => void; onSend: (amount: number, description: string) => Promise<void> }) {
  const [f, setF] = useState({ amount: '', description: '' })
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} onClose={onClose} title="Request payment" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!Number(f.amount) || f.description.length < 2} onClick={async () => { setBusy(true); try { await onSend(Number(f.amount), f.description); onClose(); setF({ amount: '', description: '' }) } finally { setBusy(false) } }}>Create & send link</Button></>}>
      <p className="mb-4 text-sm text-muted">Creates a Razorpay payment link on your account and sends it with a “Pay now” button. You are notified when it is paid.</p>
      <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
        <Field label="Amount (₹)"><Input type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="For"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Website design advance" /></Field>
      </div>
    </Modal>
  )
}
