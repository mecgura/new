import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarDays, CalendarCheck, ChevronLeft, ChevronRight, Plus, Copy, RefreshCw, Clock, Trash2, MessageCircle, Settings2, List } from 'lucide-react'
import { post, put, patch } from '../../lib/api'
import { useApi, useEvents } from '../../lib/hooks'
import { useSession } from '../../lib/session'
import { time, phone, titleCase } from '../../lib/format'
import { Badge, Button, Card, Drawer, Empty, Field, Input, Loading, Modal, PageHeader, Select, Stat, Tabs, Textarea, Toggle, useToast, cx, Table, Td } from '../../components/ui'

type Service = { name: string; duration: number; price?: number }
type Settings = {
  enabled: boolean; services: Service[]; days: number[]; start: string; end: string; break_start: string; break_end: string; slot_minutes: number; capacity: number
  days_ahead: number; min_notice_minutes: number; reminder_minutes: number; confirm_text: string; reminder_text: string; timezone: string; ics_url: string; google_subscribe_url: string
}
type Appt = { id: number; contact_id: number | null; contact_name: string | null; wa_id: string | null; conversation_id: number | null; service: string; starts_at: string; ends_at: string; status: string; notes: string | null; source: string; agent_name: string | null; reminder_sent: number }
type Resp = { items: Appt[]; stats: { upcoming: number | null; today: number | null } }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const tone = (s: string) => ({ booked: 'green', completed: 'blue', no_show: 'amber', cancelled: 'red' }[s] ?? 'gray')
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const startOfWeek = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const dayLabel = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

export default function Calendar() {
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'week' | 'list' | 'settings'>('week')
  const [week, setWeek] = useState(() => startOfWeek(new Date()))
  const [open, setOpen] = useState<Appt | null>(null)
  const [creating, setCreating] = useState(params.get('new') === '1')
  const { can } = useSession()
  const from = week.toISOString(), to = addDays(week, 7).toISOString()
  const [listFrom] = useState(() => new Date(Date.now() - 3600000).toISOString())
  const path = tab === 'list' ? `appointments?from=${encodeURIComponent(listFrom)}` : `appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  const { data, reload } = useApi<Resp>(path)
  const settings = useApi<Settings>('booking/settings')
  useEvents((type) => { if (type === 'appointment') void reload() })
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week])
  const today = ymd(new Date())

  return (
    <>
      <PageHeader title="Calendar & bookings" subtitle="Customers book free slots on WhatsApp through the Flow Builder. Reminders go out automatically and everything syncs to Google Calendar."
        actions={<Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New appointment</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today" value={data?.stats.today ?? 0} icon={<CalendarDays className="size-4" />} />
        <Stat label="Upcoming" value={data?.stats.upcoming ?? 0} icon={<CalendarCheck className="size-4" />} />
        <Stat label="Booking hours" value={settings.data ? `${settings.data.start}–${settings.data.end}` : '—'} hint={settings.data?.days.map((d) => DAYS[d]).join(' ')} icon={<Clock className="size-4" />} />
        <Stat label="Services" value={settings.data?.services.length ?? 0} hint={settings.data?.services.map((s) => s.name).join(', ')} icon={<List className="size-4" />} />
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'week', label: 'Week' }, { id: 'list', label: 'Upcoming' }, ...(can('settings.manage') ? [{ id: 'settings' as const, label: 'Booking settings' }] : [])]} />
        {tab === 'week' && <div className="flex items-center gap-2">
          <Button size="sm" variant="subtle" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft className="size-4" /></Button>
          <Button size="sm" variant="subtle" onClick={() => setWeek(startOfWeek(new Date()))}>Today</Button>
          <Button size="sm" variant="subtle" onClick={() => setWeek(addDays(week, 7))}><ChevronRight className="size-4" /></Button>
          <span className="ml-1 text-sm text-soft">{dayLabel(week)} – {dayLabel(addDays(week, 6))}</span>
        </div>}
      </div>

      {tab === 'settings' ? (settings.data ? <SettingsForm key={JSON.stringify(settings.data)} initial={settings.data} onSaved={(s) => settings.setData(s)} /> : <Loading />)
        : !data ? <Loading />
          : tab === 'week' ? (
            <div className="grid gap-3 md:grid-cols-7">
              {days.map((d) => {
                const items = data.items.filter((a) => ymd(new Date(a.starts_at)) === ymd(d))
                return (
                  <div key={ymd(d)} className={cx('min-h-40 rounded-2xl border bg-card p-2.5', ymd(d) === today ? 'border-brand/60' : 'border-line')}>
                    <div className={cx('mb-2 px-1 text-xs font-semibold', ymd(d) === today ? 'text-brand-2' : 'text-muted')}>{dayLabel(d)}</div>
                    <div className="space-y-1.5">
                      {items.map((a) => (
                        <button key={a.id} onClick={() => setOpen(a)} className={cx('w-full rounded-xl border px-2.5 py-2 text-left transition hover:border-brand/50', a.status === 'cancelled' ? 'border-line opacity-50' : 'border-line bg-panel')}>
                          <div className="text-xs font-semibold text-white">{time(a.starts_at)}</div>
                          <div className="truncate text-xs text-soft">{a.contact_name || phone(a.wa_id)}</div>
                          <div className="truncate text-[11px] text-muted">{a.service}</div>
                        </button>
                      ))}
                      {!items.length && <div className="px-1 py-3 text-[11px] text-line-strong">—</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : data.items.filter((a) => a.status === 'booked').length === 0 ? <Card><Empty icon={<CalendarDays className="size-5" />} title="No upcoming appointments" text="Add a “Book appointment” step to a flow so customers can book on WhatsApp, or add one manually." action={<Link to="/app/flows"><Button variant="subtle">Open Flow Builder</Button></Link>} /></Card> : (
            <Card pad={false}>
              <Table head={['When', 'Customer', 'Service', 'Status', 'Source', '']}>
                {data.items.filter((a) => a.status === 'booked').map((a) => <tr key={a.id}>
                  <Td className="text-white">{dayLabel(new Date(a.starts_at))} · {time(a.starts_at)}</Td>
                  <Td><div className="text-white">{a.contact_name || '—'}</div><div className="text-xs text-muted">{phone(a.wa_id)}</div></Td>
                  <Td>{a.service}</Td><Td><Badge tone={tone(a.status)}>{titleCase(a.status)}</Badge></Td><Td className="text-xs capitalize">{a.source}</Td>
                  <Td className="text-right"><Button size="sm" variant="subtle" onClick={() => setOpen(a)}>Open</Button></Td>
                </tr>)}
              </Table>
            </Card>
          )}

      {open && <ApptDrawer key={open.id} appt={open} services={settings.data?.services ?? []} onClose={() => setOpen(null)} onChanged={(a) => { setOpen(a); void reload() }} />}
      {creating && settings.data && <NewAppt services={settings.data.services} prefill={{ phone: params.get('phone') ?? '', name: params.get('name') ?? '' }}
        onClose={() => { setCreating(false); if (params.get('new')) setParams({}) }} onSaved={() => void reload()} />}
    </>
  )
}

function SlotPicker({ service, date, value, onChange, ignore }: { service: string; date: string; value: string; onChange: (v: string) => void; ignore?: number }) {
  const { data } = useApi<{ slots: string[] }>(date ? `booking/slots?date=${date}&service=${encodeURIComponent(service)}${ignore ? `&ignore=${ignore}` : ''}` : null)
  if (!date) return null
  if (!data) return <div className="text-xs text-muted">Loading free slots…</div>
  if (!data.slots.length) return <div className="rounded-xl border border-line bg-panel px-3 py-2 text-xs text-muted">No free slots on this day. Pick another day or use a custom time.</div>
  return <div className="flex flex-wrap gap-1.5">{data.slots.map((s) => <button key={s} type="button" onClick={() => onChange(s)}
    className={cx('rounded-lg border px-2.5 py-1.5 text-xs', value === s ? 'border-brand bg-brand/15 text-white' : 'border-line text-soft hover:border-line-strong')}>{time(s)}</button>)}</div>
}

function NewAppt({ services, prefill, onClose, onSaved }: { services: Service[]; prefill: { phone: string; name: string }; onClose: () => void; onSaved: () => void }) {
  const t = useToast()
  const [f, setF] = useState({ phone: prefill.phone, name: prefill.name, service: services[0]?.name ?? '', date: ymd(new Date()), slot: '', custom: false, customTime: '10:00', notes: '', notify: true })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const starts_at = f.custom ? new Date(`${f.date}T${f.customTime}`).toISOString() : f.slot
      const r = await post<{ warning?: string }>('appointments', { phone: f.phone, name: f.name || undefined, service: f.service || undefined, starts_at, notes: f.notes || undefined, notify: f.notify, force: f.custom })
      if (r.warning) t.err(r.warning); else t.ok('Appointment booked')
      onSaved(); onClose()
    } catch (e) { t.err(e) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title="New appointment" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.phone || (!f.custom && !f.slot)} onClick={save}>Book</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="WhatsApp number"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="98765 43210" /></Field>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Service"><Select value={f.service} onChange={(e) => setF({ ...f, service: e.target.value, slot: '' })}>{services.map((s) => <option key={s.name} value={s.name}>{s.name} · {s.duration} min</option>)}</Select></Field>
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value, slot: '' })} /></Field>
        </div>
        {f.custom ? <Field label="Custom time" hint="Books even outside hours or when the slot is full"><Input type="time" value={f.customTime} onChange={(e) => setF({ ...f, customTime: e.target.value })} /></Field>
          : <Field label="Free slots"><SlotPicker service={f.service} date={f.date} value={f.slot} onChange={(slot) => setF({ ...f, slot })} /></Field>}
        <label className="flex items-center gap-2 text-xs text-soft"><input type="checkbox" className="accent-emerald-500" checked={f.custom} onChange={(e) => setF({ ...f, custom: e.target.checked })} />Book anyway at a custom time</label>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Toggle checked={f.notify} onChange={(notify) => setF({ ...f, notify })} label="Send WhatsApp confirmation to the customer" />
      </div>
    </Modal>
  )
}

function ApptDrawer({ appt, services, onClose, onChanged }: { appt: Appt; services: Service[]; onClose: () => void; onChanged: (a: Appt) => void }) {
  const t = useToast()
  const [notes, setNotes] = useState(appt.notes ?? '')
  const [notify, setNotify] = useState(true)
  const [re, setRe] = useState({ open: false, date: ymd(new Date(appt.starts_at)), slot: '' })
  const act = async (body: Record<string, unknown>, msg: string) => {
    try { const r = await patch<Appt & { warning?: string }>(`appointments/${appt.id}`, { ...body, notify }); if (r.warning) t.err(r.warning); else t.ok(msg); onChanged(r) } catch (e) { t.err(e) }
  }
  const svc = services.find((s) => s.name === appt.service)?.name ?? appt.service
  return (
    <Drawer open onClose={onClose} title="Appointment">
      <div className="space-y-5">
        <div>
          <div className="font-display text-xl font-bold text-white">{dayLabel(new Date(appt.starts_at))} · {time(appt.starts_at)}</div>
          <div className="mt-1 text-sm text-soft">{appt.service} · until {time(appt.ends_at)}</div>
          <div className="mt-2 flex gap-2"><Badge tone={tone(appt.status)}>{titleCase(appt.status)}</Badge><Badge>{appt.source}</Badge>{appt.reminder_sent === 1 && <Badge tone="blue">Reminder sent</Badge>}</div>
        </div>
        <Card>
          <div className="text-sm font-medium text-white">{appt.contact_name || 'Customer'}</div>
          <div className="text-xs text-muted">{phone(appt.wa_id)}</div>
          {appt.contact_id && <Link to={appt.conversation_id ? `/app/inbox?c=${appt.conversation_id}` : '/app/contacts'} className="mt-2 inline-flex items-center gap-1 text-xs text-brand-2"><MessageCircle className="size-3.5" />{appt.conversation_id ? 'Open chat' : 'Open contacts'}</Link>}
        </Card>
        <Toggle checked={notify} onChange={setNotify} label="Tell the customer on WhatsApp" />
        {appt.status === 'booked' && <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => act({ status: 'completed' }, 'Marked completed')}>Completed</Button>
          <Button size="sm" variant="subtle" onClick={() => act({ status: 'no_show' }, 'Marked no-show')}>No-show</Button>
          <Button size="sm" variant="subtle" icon={<RefreshCw className="size-3.5" />} onClick={() => setRe({ ...re, open: !re.open })}>Reschedule</Button>
          <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => act({ status: 'cancelled' }, 'Appointment cancelled')}>Cancel</Button>
        </div>}
        {re.open && <Card>
          <Field label="New date"><Input type="date" value={re.date} onChange={(e) => setRe({ ...re, date: e.target.value, slot: '' })} /></Field>
          <div className="mt-3"><SlotPicker service={svc} date={re.date} value={re.slot} ignore={appt.id} onChange={(slot) => setRe({ ...re, slot })} /></div>
          <Button className="mt-3" size="sm" disabled={!re.slot} onClick={async () => { await act({ starts_at: re.slot }, 'Rescheduled'); setRe({ ...re, open: false }) }}>Move appointment</Button>
        </Card>}
        <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Button size="sm" variant="subtle" disabled={notes === (appt.notes ?? '')} onClick={() => act({ notes, notify: false }, 'Notes saved')}>Save notes</Button>
      </div>
    </Drawer>
  )
}

function SettingsForm({ initial, onSaved }: { initial: Settings; onSaved: (s: Settings) => void }) {
  const t = useToast()
  const [s, setS] = useState(initial)
  const [busy, setBusy] = useState(false)
  const n = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Math.max(0, Number(e.target.value) || 0) })
  const save = async () => {
    setBusy(true)
    try {
      const { enabled, services, days, start, end, break_start, break_end, slot_minutes, capacity, days_ahead, min_notice_minutes, reminder_minutes, confirm_text, reminder_text } = s
      onSaved(await put<Settings>('booking/settings', { enabled, services: services.filter((x) => x.name.trim()), days, start, end, break_start, break_end, slot_minutes, capacity: Math.max(1, capacity), days_ahead: Math.max(1, days_ahead), min_notice_minutes, reminder_minutes, confirm_text, reminder_text }))
      t.ok('Booking settings saved')
    } catch (e) { t.err(e) } finally { setBusy(false) }
  }
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><Settings2 className="size-4 text-brand" />Services</span>}>
        <div className="space-y-2">
          {s.services.map((x, i) => <div key={i} className="flex gap-2">
            <Input value={x.name} placeholder="Service name" onChange={(e) => setS({ ...s, services: s.services.map((y, j) => j === i ? { ...y, name: e.target.value } : y) })} />
            <Input className="!w-28" type="number" min={5} value={x.duration} onChange={(e) => setS({ ...s, services: s.services.map((y, j) => j === i ? { ...y, duration: Number(e.target.value) || 30 } : y) })} />
            <span className="self-center text-xs text-muted">min</span>
            <button className="text-muted hover:text-red-300 disabled:opacity-30" disabled={s.services.length <= 1} onClick={() => setS({ ...s, services: s.services.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></button>
          </div>)}
        </div>
        <Button className="mt-3" size="sm" variant="subtle" icon={<Plus className="size-3.5" />} onClick={() => setS({ ...s, services: [...s.services, { name: '', duration: 30 }] })}>Add service</Button>
        <p className="mt-3 text-xs text-muted">e.g. Consultation 30 min, Haircut 45 min, Site visit 60 min, Demo call 20 min.</p>
      </Card>
      <Card title={<span className="flex items-center gap-2"><Clock className="size-4 text-brand" />Working hours <span className="text-xs font-normal text-muted">({s.timezone})</span></span>}>
        <div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => <button key={d} onClick={() => setS({ ...s, days: s.days.includes(i) ? s.days.filter((x) => x !== i) : [...s.days, i].sort() })}
          className={cx('rounded-lg border px-3 py-1.5 text-xs', s.days.includes(i) ? 'border-brand bg-brand/15 text-white' : 'border-line text-muted')}>{d}</button>)}</div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Opens"><Input type="time" value={s.start} onChange={(e) => setS({ ...s, start: e.target.value })} /></Field>
          <Field label="Closes"><Input type="time" value={s.end} onChange={(e) => setS({ ...s, end: e.target.value })} /></Field>
          <Field label="Break from (optional)"><Input type="time" value={s.break_start} onChange={(e) => setS({ ...s, break_start: e.target.value })} /></Field>
          <Field label="Break until"><Input type="time" value={s.break_end} onChange={(e) => setS({ ...s, break_end: e.target.value })} /></Field>
          <Field label="Slot every (min)"><Input type="number" value={s.slot_minutes} onChange={n('slot_minutes')} /></Field>
          <Field label="Bookings per slot" hint="Staff / chairs / rooms"><Input type="number" value={s.capacity} onChange={n('capacity')} /></Field>
          <Field label="Days ahead customers can book"><Input type="number" value={s.days_ahead} onChange={n('days_ahead')} /></Field>
          <Field label="Minimum notice (min)"><Input type="number" value={s.min_notice_minutes} onChange={n('min_notice_minutes')} /></Field>
        </div>
      </Card>
      <Card title="WhatsApp messages">
        <Field label="Confirmation" hint="{{service}} {{date}} {{time}} {{calendar_link}} {{name}}"><Textarea rows={4} value={s.confirm_text} onChange={(e) => setS({ ...s, confirm_text: e.target.value })} /></Field>
        <div className="mt-3 grid grid-cols-[1fr_140px] gap-3">
          <Field label="Reminder"><Textarea rows={3} value={s.reminder_text} onChange={(e) => setS({ ...s, reminder_text: e.target.value })} /></Field>
          <Field label="Send before (min)" hint="0 = off"><Input type="number" value={s.reminder_minutes} onChange={n('reminder_minutes')} /></Field>
        </div>
        <p className="mt-2 text-xs text-muted">Reminders are free-form WhatsApp messages, so they reach customers who chatted in the last 24 hours (bookings made on WhatsApp usually are).</p>
      </Card>
      <Card title={<span className="flex items-center gap-2"><CalendarDays className="size-4 text-brand" />Google Calendar sync</span>}>
        <p className="text-sm text-soft">Subscribe once and every booking shows up in Google Calendar on your phone and laptop (also works with Outlook and Apple Calendar).</p>
        <div className="mt-3 flex gap-2"><Input readOnly value={s.ics_url} /><Button variant="subtle" onClick={() => { void navigator.clipboard.writeText(s.ics_url); t.ok('Calendar link copied') }}><Copy className="size-4" /></Button></div>
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={s.google_subscribe_url} target="_blank" rel="noreferrer"><Button size="sm" icon={<CalendarCheck className="size-3.5" />}>Add to Google Calendar</Button></a>
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={async () => { try { onSaved(await post<Settings>('booking/calendar-token')); t.ok('New private link created — the old one stops working') } catch (e) { t.err(e) } }}>Reset link</Button>
        </div>
        <p className="mt-3 text-xs text-muted">Keep this link private. Google refreshes subscribed calendars every few hours.</p>
      </Card>
      <div className="lg:col-span-2"><Button loading={busy} onClick={save}>Save booking settings</Button></div>
    </div>
  )
}
