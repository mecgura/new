import { all, get, insert, run, update, now } from '../db.ts'
import { renderVars } from '../lib/util.ts'
import { randomToken } from '../lib/security.ts'
import { publish } from '../lib/events.ts'
import { config } from '../config.ts'
import type { OutMessage } from './whatsapp.ts'
import { sendToContact, contactContext, notify, type Contact } from './messaging.ts'
import { emitEvent } from './hooks.ts'

// ---------- Settings ----------
export type Service = { name: string; duration: number; price?: number }
export type Booking = {
  enabled: boolean; services: Service[]; days: number[]; start: string; end: string; break_start: string; break_end: string
  slot_minutes: number; capacity: number; days_ahead: number; min_notice_minutes: number
  reminder_minutes: number; confirm_text: string; reminder_text: string; calendar_token?: string
}
export const BOOKING_DEFAULT: Booking = {
  enabled: true, services: [{ name: 'Consultation', duration: 30 }], days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '19:00',
  break_start: '', break_end: '', slot_minutes: 30, capacity: 1, days_ahead: 7, min_notice_minutes: 60, reminder_minutes: 120,
  confirm_text: '✅ Booked! *{{service}}* on *{{date}}* at *{{time}}*.\n\nAdd it to your Google Calendar: {{calendar_link}}',
  reminder_text: '⏰ Reminder: your *{{service}}* is on {{date}} at {{time}}. Reply here if you need to reschedule.',
}

type Ws = { id: number; name: string; timezone: string; settings: { booking?: Partial<Booking> } & Record<string, unknown> }
const wsRow = (workspaceId: number) => get<Ws>('SELECT id, name, timezone, settings FROM workspaces WHERE id = ?', workspaceId)!
export const tzOf = (workspaceId: number) => wsRow(workspaceId).timezone || 'Asia/Kolkata'

export function bookingSettings(workspaceId: number): Booking {
  const b = { ...BOOKING_DEFAULT, ...(wsRow(workspaceId).settings?.booking ?? {}) }
  if (!b.services?.length) b.services = BOOKING_DEFAULT.services
  return b
}

export function saveBookingSettings(workspaceId: number, patch: Partial<Booking>) {
  const ws = wsRow(workspaceId)
  const booking = { ...BOOKING_DEFAULT, ...(ws.settings?.booking ?? {}), ...patch }
  update('workspaces', workspaceId, { settings: { ...ws.settings, booking } })
  return booking
}

export function calendarToken(workspaceId: number, rotate = false) {
  const b = bookingSettings(workspaceId)
  if (b.calendar_token && !rotate) return b.calendar_token
  return saveBookingSettings(workspaceId, { calendar_token: randomToken(18) }).calendar_token!
}
export const icsUrl = (token: string) => `${config.apiUrl}/cal/${token}.ics`

// ---------- Time zone helpers (no external deps) ----------
function tzOffsetMs(at: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at).map((x) => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at.getTime() / 1000) * 1000
}
/** Local wall time (YYYY-MM-DD + HH:MM) in `tz` → UTC Date. */
export function localToUtc(date: string, hm: string, tz: string) {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = hm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  let t = guess - tzOffsetMs(new Date(guess), tz)
  const off2 = tzOffsetMs(new Date(t), tz)
  if (guess - off2 !== t) t = guess - off2
  return new Date(t)
}
export const localDate = (at: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay()
export const fmtDay = (at: Date, tz: string) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(at)
export const fmtTime = (at: Date, tz: string) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(at).toUpperCase()
const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0) }
const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

// ---------- Availability ----------
export function serviceOf(b: Booking, name?: string) {
  return b.services.find((s) => s.name.toLowerCase() === String(name ?? '').toLowerCase()) ?? b.services[0]
}

/** Free start times (UTC ISO) on a local date for a service duration. */
export function slotsFor(workspaceId: number, date: string, duration: number, ignoreId?: number): string[] {
  const b = bookingSettings(workspaceId)
  const tz = tzOf(workspaceId)
  if (!b.days.includes(weekday(date))) return []
  const dayStart = localToUtc(date, '00:00', tz).toISOString()
  const dayEnd = localToUtc(addDays(date, 1), '00:00', tz).toISOString()
  const booked = all<{ starts_at: string; ends_at: string }>(
    "SELECT starts_at, ends_at FROM appointments WHERE workspace_id = ? AND status = 'booked' AND starts_at < ? AND ends_at > ? AND id != ?",
    workspaceId, dayEnd, dayStart, ignoreId ?? 0)
  const earliest = Date.now() + b.min_notice_minutes * 60000
  const step = Math.max(5, b.slot_minutes || 30)
  const out: string[] = []
  for (let m = toMin(b.start); m + duration <= toMin(b.end); m += step) {
    if (b.break_start && b.break_end && m < toMin(b.break_end) && m + duration > toMin(b.break_start)) continue
    const s = localToUtc(date, fromMin(m), tz)
    const e = new Date(s.getTime() + duration * 60000)
    if (s.getTime() < earliest) continue
    const overlap = booked.filter((a) => a.starts_at < e.toISOString() && a.ends_at > s.toISOString()).length
    if (overlap < Math.max(1, b.capacity)) out.push(s.toISOString())
  }
  return out
}

export function openDays(workspaceId: number, duration: number, max = 10) {
  const b = bookingSettings(workspaceId)
  const today = localDate(new Date(), tzOf(workspaceId))
  const days: string[] = []
  for (let i = 0; i <= Math.min(60, b.days_ahead) && days.length < max; i++) {
    const d = addDays(today, i)
    if (slotsFor(workspaceId, d, duration).length) days.push(d)
  }
  return days
}

// ---------- Appointments ----------
export type Appointment = { id: number; workspace_id: number; contact_id: number | null; conversation_id: number | null; assigned_to: number | null; service: string; starts_at: string; ends_at: string; status: string; notes: string | null; source: string; reminder_sent: number; created_at: string }

export function googleCalendarLink(a: Pick<Appointment, 'service' | 'starts_at' | 'ends_at' | 'notes'>, title: string) {
  const f = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${f(a.starts_at)}/${f(a.ends_at)}`, details: a.notes || a.service })
  return `https://calendar.google.com/calendar/render?${q}`
}

export function apptVars(a: Appointment, workspaceId: number) {
  const ws = wsRow(workspaceId)
  const tz = ws.timezone || 'Asia/Kolkata'
  const s = new Date(a.starts_at)
  return { service: a.service, date: fmtDay(s, tz), time: fmtTime(s, tz), business: ws.name, calendar_link: googleCalendarLink(a, `${a.service} — ${ws.name}`) }
}

export function createAppointment(o: { workspaceId: number; contactId: number | null; conversationId?: number | null; service: string; startsAt: string; duration: number; notes?: string; source: string; createdBy?: number | null; assignedTo?: number | null }) {
  const ends = new Date(Date.parse(o.startsAt) + o.duration * 60000).toISOString()
  const aid = insert('appointments', {
    workspace_id: o.workspaceId, contact_id: o.contactId, conversation_id: o.conversationId ?? null, assigned_to: o.assignedTo ?? null, service: o.service,
    starts_at: new Date(o.startsAt).toISOString(), ends_at: ends, status: 'booked', notes: o.notes ?? null, source: o.source, created_by: o.createdBy ?? null, created_at: now(),
  })
  const a = get<Appointment>('SELECT * FROM appointments WHERE id = ?', aid)!
  const c = o.contactId ? get<Contact>('SELECT * FROM contacts WHERE id = ?', o.contactId) : undefined
  const v = apptVars(a, o.workspaceId)
  notify(o.workspaceId, { title: 'New appointment', body: `${c?.name || c?.wa_id || 'Customer'} · ${a.service} · ${v.date} ${v.time}`, link: '/app/calendar', type: 'booking', userId: o.assignedTo ?? null })
  publish(o.workspaceId, 'appointment', { id: aid })
  emitEvent(o.workspaceId, 'appointment.booked', { ...a, contact: c ? { id: c.id, name: c.name, phone: c.wa_id } : null })
  return a
}

export async function sendAppointmentMessage(a: Appointment, text: string) {
  if (!a.contact_id) return
  const c = get<Contact>('SELECT * FROM contacts WHERE id = ?', a.contact_id)
  if (!c) return
  await sendToContact({ workspaceId: a.workspace_id, contactId: c.id, sentBy: 'bot', message: { type: 'text', text: renderVars(text, { ...contactContext(c), ...apptVars(a, a.workspace_id) }) } })
}

/** Worker: WhatsApp reminders before appointments. */
export async function processAppointmentReminders() {
  const soon = all<Appointment>("SELECT * FROM appointments WHERE status = 'booked' AND reminder_sent = 0 AND starts_at > ? AND starts_at <= ? LIMIT 100",
    now(), new Date(Date.now() + 2 * 86400000).toISOString())
  for (const a of soon) {
    const b = bookingSettings(a.workspace_id)
    if (!b.reminder_minutes || Date.parse(a.starts_at) - Date.now() > b.reminder_minutes * 60000) continue
    try { await sendAppointmentMessage(a, b.reminder_text); update('appointments', a.id, { reminder_sent: 1 }) } catch (e) {
      update('appointments', a.id, { reminder_sent: 2 })
      console.warn('appointment reminder failed', (e as Error).message)
    }
  }
}

// ---------- ICS feed (subscribe from Google Calendar / Outlook / Apple) ----------
export function icsFeed(token: string) {
  const ws = get<{ id: number; name: string }>("SELECT id, name FROM workspaces WHERE json_extract(settings, '$.booking.calendar_token') = ?", token)
  if (!ws) return null
  const rows = all<Appointment & { contact_name: string | null; wa_id: string | null }>(`SELECT a.*, c.name AS contact_name, c.wa_id FROM appointments a
    LEFT JOIN contacts c ON c.id = a.contact_id WHERE a.workspace_id = ? AND a.status != 'cancelled' AND a.starts_at >= ? ORDER BY a.starts_at LIMIT 2000`,
  ws.id, new Date(Date.now() - 60 * 86400000).toISOString())
  const f = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MECGURA//WhatsApp Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(`${ws.name} bookings`)}`]
  for (const a of rows) {
    const who = a.contact_name || (a.wa_id ? `+${a.wa_id}` : 'Customer')
    lines.push('BEGIN:VEVENT', `UID:appt-${a.id}@mecgura.tech`, `DTSTAMP:${f(a.created_at)}`, `DTSTART:${f(a.starts_at)}`, `DTEND:${f(a.ends_at)}`,
      `SUMMARY:${esc(`${a.service} — ${who}`)}`, `DESCRIPTION:${esc([a.wa_id ? `WhatsApp: +${a.wa_id}` : '', a.notes ?? '', `Status: ${a.status}`].filter(Boolean).join('\n'))}`, 'END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

// ---------- Flow "booking" step ----------
type Row = { id: string; title: string; description?: string }
type BState = { stage: 'day' | 'slot'; rows: Row[]; date?: string; offset?: number }
type FlowRun = { id: number; workspace_id: number; conversation_id: number | null; state: Record<string, unknown> }

function pickRow(st: BState, nodeId: string, input: { text: string; buttonId?: string }): Row | undefined {
  if (input.buttonId?.startsWith(`flow:${nodeId}:`)) {
    const key = input.buttonId.slice(`flow:${nodeId}:`.length)
    return st.rows.find((r) => r.id === key)
  }
  const t = input.text.trim().toLowerCase()
  const n = Number(t)
  if (Number.isInteger(n) && n >= 1 && n <= st.rows.length) return st.rows[n - 1]
  return st.rows.find((r) => r.title.toLowerCase() === t)
}

function listMsg(nodeId: string, text: string, button: string, rows: Row[]): OutMessage {
  return { type: 'list', text, button, sections: [{ title: button, rows: rows.map((r) => ({ id: `flow:${nodeId}:${r.id}`, title: r.title.slice(0, 24), description: r.description })) }] }
}

/** Runs one turn of a booking step. Returns 'wait' (asked the customer), 'booked' or 'none' (no free slots). */
export async function bookingStep(r: FlowRun, node: { id: string; data: Record<string, unknown> }, contact: Contact, input: { text: string; buttonId?: string } | undefined,
  send: (m: OutMessage) => Promise<unknown>): Promise<'wait' | 'booked' | 'none'> {
  const b = bookingSettings(r.workspace_id)
  const tz = tzOf(r.workspace_id)
  const svc = serviceOf(b, String(node.data.service ?? ''))
  const st = r.state.__booking as BState | undefined
  const dayText = String(node.data.text || `Book your *${svc.name}* 📅\nWhich day works for you?`)

  const askDays = async (prefix = '') => {
    const days = openDays(r.workspace_id, svc.duration)
    if (!days.length) {
      delete r.state.__booking
      await send({ type: 'text', text: String(node.data.none_text || 'Sorry, there are no free slots right now. Our team will contact you shortly.') })
      return 'none' as const
    }
    const rows = days.map((d) => ({ id: `d:${d}`, title: fmtDay(localToUtc(d, '12:00', tz), tz), description: `${slotsFor(r.workspace_id, d, svc.duration).length} slots free` }))
    r.state.__booking = { stage: 'day', rows } satisfies BState
    await send(listMsg(node.id, prefix + dayText, 'Choose a day', rows))
    return 'wait' as const
  }
  const askSlots = async (date: string, offset = 0, prefix = '') => {
    const slots = slotsFor(r.workspace_id, date, svc.duration)
    if (!slots.length) return askDays('That day just filled up. ')
    const page = slots.slice(offset, offset + (slots.length - offset > 10 ? 9 : 10))
    const rows: Row[] = page.map((s) => ({ id: `s:${s}`, title: fmtTime(new Date(s), tz) }))
    if (offset + page.length < slots.length) rows.push({ id: `m:${offset + page.length}`, title: 'Later times ➜' })
    r.state.__booking = { stage: 'slot', rows, date, offset } satisfies BState
    await send(listMsg(node.id, `${prefix}${String(node.data.slot_text || 'Pick a time')} for ${fmtDay(localToUtc(date, '12:00', tz), tz)}:`, 'Choose a time', rows))
    return 'wait' as const
  }

  if (!st || !input) return askDays()
  const pick = pickRow(st, node.id, input)
  if (!pick) return st.stage === 'slot' && st.date ? askSlots(st.date, st.offset, 'Please choose a time from the list. ') : askDays('Please choose a day from the list. ')
  if (pick.id.startsWith('d:')) return askSlots(pick.id.slice(2))
  if (pick.id.startsWith('m:')) return askSlots(st.date!, Number(pick.id.slice(2)))

  const startsAt = pick.id.slice(2)
  if (!slotsFor(r.workspace_id, st.date!, svc.duration).includes(startsAt)) return askSlots(st.date!, 0, 'Sorry, that time was just taken. ')
  const conv = r.conversation_id ? get<{ assigned_to: number | null }>('SELECT assigned_to FROM conversations WHERE id = ?', r.conversation_id) : undefined
  const a = createAppointment({ workspaceId: r.workspace_id, contactId: contact.id, conversationId: r.conversation_id, service: svc.name, startsAt, duration: svc.duration, source: 'whatsapp', assignedTo: conv?.assigned_to ?? null })
  delete r.state.__booking
  const v = apptVars(a, r.workspace_id)
  Object.assign(r.state, { appointment_id: a.id, appointment_service: v.service, appointment_date: v.date, appointment_time: v.time })
  await send({ type: 'text', text: renderVars(String(node.data.confirm_text || b.confirm_text), { ...contactContext(contact), ...v }) })
  return 'booked'
}

export function cancelAppointment(a: Appointment) {
  run("UPDATE appointments SET status = 'cancelled' WHERE id = ?", a.id)
  publish(a.workspace_id, 'appointment', { id: a.id })
  emitEvent(a.workspace_id, 'appointment.cancelled', a)
}
