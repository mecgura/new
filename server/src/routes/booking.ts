import { Router } from 'express'
import { z } from 'zod'
import { all, get, update } from '../db.ts'
import { h, parse, bad, id, notFound } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { upsertContact } from '../services/messaging.ts'
import {
  bookingSettings, saveBookingSettings, calendarToken, icsUrl, slotsFor, serviceOf, createAppointment, cancelAppointment, sendAppointmentMessage,
  icsFeed, tzOf, localDate, type Appointment,
} from '../services/booking.ts'
import { publish } from '../lib/events.ts'

export const bookingRoutes = Router()
const VIEW = perm('inbox.view')
const EDIT = perm('inbox.reply')
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')

function settingsOut(workspaceId: number) {
  const b = bookingSettings(workspaceId)
  const token = calendarToken(workspaceId)
  const ics = icsUrl(token)
  return { ...b, calendar_token: undefined, timezone: tzOf(workspaceId), ics_url: ics,
    google_subscribe_url: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(ics.replace(/^https?:/, 'webcal:'))}` }
}

bookingRoutes.get('/booking/settings', VIEW, h((req, res) => { res.json(settingsOut(req.ws!.id)) }))
bookingRoutes.put('/booking/settings', perm('settings.manage'), h((req, res) => {
  const b = parse(z.object({
    enabled: z.boolean().optional(),
    services: z.array(z.object({ name: z.string().trim().min(1).max(40), duration: z.number().int().min(5).max(600), price: z.number().min(0).optional() })).min(1).max(20).optional(),
    days: z.array(z.number().int().min(0).max(6)).optional(), start: hm.optional(), end: hm.optional(),
    break_start: hm.or(z.literal('')).optional(), break_end: hm.or(z.literal('')).optional(),
    slot_minutes: z.number().int().min(5).max(240).optional(), capacity: z.number().int().min(1).max(100).optional(),
    days_ahead: z.number().int().min(1).max(60).optional(), min_notice_minutes: z.number().int().min(0).max(10080).optional(),
    reminder_minutes: z.number().int().min(0).max(2880).optional(),
    confirm_text: z.string().max(1000).optional(), reminder_text: z.string().max(1000).optional(),
  }), req.body)
  if (b.start && b.end && b.start >= b.end) throw bad('Closing time must be after opening time')
  saveBookingSettings(req.ws!.id, b)
  res.json(settingsOut(req.ws!.id))
}))
bookingRoutes.post('/booking/calendar-token', perm('settings.manage'), h((req, res) => { calendarToken(req.ws!.id, true); res.json(settingsOut(req.ws!.id)) }))

bookingRoutes.get('/booking/slots', VIEW, h((req, res) => {
  const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), service: z.string().optional(), ignore: z.coerce.number().optional() }), req.query)
  const svc = serviceOf(bookingSettings(req.ws!.id), q.service)
  res.json({ service: svc, slots: slotsFor(req.ws!.id, q.date, svc.duration, q.ignore) })
}))

const SELECT = `SELECT a.*, c.name AS contact_name, c.wa_id, u.name AS agent_name FROM appointments a
  LEFT JOIN contacts c ON c.id = a.contact_id LEFT JOIN users u ON u.id = a.assigned_to`

bookingRoutes.get('/appointments', VIEW, h((req, res) => {
  const q = parse(z.object({ from: z.string().optional(), to: z.string().optional(), contact_id: z.coerce.number().optional() }), req.query)
  const where = ['a.workspace_id = ?']; const p: unknown[] = [req.ws!.id]
  if (q.from) { where.push('a.starts_at >= ?'); p.push(q.from) }
  if (q.to) { where.push('a.starts_at < ?'); p.push(q.to) }
  if (q.contact_id) { where.push('a.contact_id = ?'); p.push(q.contact_id) }
  const today = localDate(new Date(), tzOf(req.ws!.id))
  const stats = get<{ upcoming: number; today: number }>(`SELECT
      SUM(CASE WHEN status = 'booked' AND starts_at >= ? THEN 1 ELSE 0 END) AS upcoming,
      SUM(CASE WHEN status != 'cancelled' AND starts_at >= ? AND starts_at < ? THEN 1 ELSE 0 END) AS today
    FROM appointments WHERE workspace_id = ?`, new Date().toISOString(), `${today}T00:00:00`, `${today}T23:59:59`, req.ws!.id)
  res.json({ items: all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY a.starts_at LIMIT 1000`, ...p), stats })
}))

bookingRoutes.post('/appointments', EDIT, h(async (req, res) => {
  const b = parse(z.object({
    contact_id: z.number().optional(), phone: z.string().optional(), name: z.string().max(80).optional(),
    service: z.string().optional(), starts_at: z.string().datetime({ offset: true }), duration: z.number().int().min(5).max(600).optional(),
    notes: z.string().max(1000).optional(), assigned_to: z.number().nullable().optional(), notify: z.boolean().default(false), force: z.boolean().default(false),
  }), req.body)
  let contactId = b.contact_id ?? null
  if (contactId && !get('SELECT id FROM contacts WHERE id = ? AND workspace_id = ?', contactId, req.ws!.id)) throw bad('Contact not found')
  if (!contactId && b.phone) contactId = upsertContact(req.ws!.id, b.phone, { name: b.name, source: 'booking' }).contact.id
  if (!contactId) throw bad('Choose a contact or enter a phone number')
  const svc = serviceOf(bookingSettings(req.ws!.id), b.service)
  const duration = b.duration ?? svc.duration
  const startsAt = new Date(b.starts_at).toISOString()
  if (!b.force && !slotsFor(req.ws!.id, localDate(new Date(startsAt), tzOf(req.ws!.id)), duration).includes(startsAt)) {
    throw bad('This time is outside booking hours or already full. Tick "Book anyway" to override.', 'slot_unavailable')
  }
  const a = createAppointment({ workspaceId: req.ws!.id, contactId, service: b.service ?? svc.name, startsAt, duration, notes: b.notes, source: 'manual', createdBy: req.user!.id, assignedTo: b.assigned_to ?? null })
  let warning: string | undefined
  if (b.notify) await sendAppointmentMessage(a, bookingSettings(req.ws!.id).confirm_text).catch((e) => { warning = `Saved, but WhatsApp confirmation failed: ${(e as Error).message}` })
  res.json({ ...get(`${SELECT} WHERE a.id = ?`, a.id), warning })
}))

bookingRoutes.patch('/appointments/:id', EDIT, h(async (req, res) => {
  const a = get<Appointment>('SELECT * FROM appointments WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!a) throw notFound('Appointment')
  const b = parse(z.object({
    status: z.enum(['booked', 'completed', 'no_show', 'cancelled']).optional(), starts_at: z.string().datetime({ offset: true }).optional(),
    notes: z.string().max(1000).nullable().optional(), assigned_to: z.number().nullable().optional(), notify: z.boolean().default(false),
  }), req.body)
  let warning: string | undefined
  const tell = async (text: string, row: Appointment) => { if (b.notify) await sendAppointmentMessage(row, text).catch((e) => { warning = `Saved, but WhatsApp message failed: ${(e as Error).message}` }) }
  if (b.status === 'cancelled' && a.status !== 'cancelled') {
    cancelAppointment(a)
    await tell('Your *{{service}}* on {{date}} at {{time}} has been cancelled. Reply here to book another time.', a)
  } else if (b.status) update('appointments', a.id, { status: b.status })
  if (b.starts_at && new Date(b.starts_at).toISOString() !== a.starts_at) {
    const dur = Date.parse(a.ends_at) - Date.parse(a.starts_at)
    const s = new Date(b.starts_at)
    update('appointments', a.id, { starts_at: s.toISOString(), ends_at: new Date(s.getTime() + dur).toISOString(), reminder_sent: 0, status: 'booked' })
    await tell('🔁 Rescheduled: your *{{service}}* is now on {{date}} at {{time}}.\n\nGoogle Calendar: {{calendar_link}}', get<Appointment>('SELECT * FROM appointments WHERE id = ?', a.id)!)
  }
  if (b.notes !== undefined) update('appointments', a.id, { notes: b.notes })
  if (b.assigned_to !== undefined) update('appointments', a.id, { assigned_to: b.assigned_to })
  publish(req.ws!.id, 'appointment', { id: a.id })
  res.json({ ...get(`${SELECT} WHERE a.id = ?`, a.id), warning })
}))

bookingRoutes.delete('/appointments/:id', EDIT, h((req, res) => {
  const a = get<Appointment>('SELECT * FROM appointments WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!a) throw notFound('Appointment')
  cancelAppointment(a)
  res.json({ ok: true })
}))

/** Public, unguessable ICS feed for Google Calendar / Outlook / Apple Calendar subscriptions. */
export const calendarFeed = Router()
calendarFeed.get('/:file', (req, res) => {
  const m = /^([A-Za-z0-9_-]{16,64})\.ics$/.exec(req.params.file)
  const body = m ? icsFeed(m[1]) : null
  if (!body) { res.status(404).send('Not found'); return }
  res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300' }).send(body)
})
