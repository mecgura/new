import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, update, now, tx } from '../db.ts'
import { h, parse, bad, id, notFound, paginate } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { parseCsv, toCsv, normalizePhone, isValidPhone } from '../lib/util.ts'
import { upsertContact } from '../services/messaging.ts'
import { onTagAdded, enrollInSequence, startFlow } from '../services/automation.ts'
import { emitEvent } from '../services/hooks.ts'
import { checkLimit } from '../services/plans.ts'

export const contactRoutes = Router()

function filters(q: Record<string, string>, wsId: number) {
  const where = ['c.workspace_id = ?']; const p: unknown[] = [wsId]
  if (q.q) { where.push('(c.name LIKE ? OR c.wa_id LIKE ? OR c.email LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`) }
  if (q.tag) { where.push('EXISTS (SELECT 1 FROM json_each(c.tags) WHERE value = ?)'); p.push(q.tag) }
  if (q.stage) { where.push('c.stage = ?'); p.push(q.stage) }
  if (q.owner) { where.push('c.owner_id = ?'); p.push(Number(q.owner)) }
  if (q.opted_out === '1') where.push('c.opted_out = 1')
  return { where: where.join(' AND '), p }
}

contactRoutes.get('/contacts', perm('contacts.view'), h((req, res) => {
  const q = req.query as Record<string, string>
  const { limit, offset, page } = paginate(q)
  const { where, p } = filters(q, req.ws!.id)
  const total = Number(get<{ c: number }>(`SELECT COUNT(*) c FROM contacts c WHERE ${where}`, ...p)!.c)
  const rows = all(`SELECT c.*, u.name AS owner_name FROM contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`, ...p, limit, offset)
  res.json({ data: rows, total, page, limit })
}))

contactRoutes.get('/contacts/tags', perm('contacts.view'), h((req, res) => {
  res.json(all<{ tag: string; c: number }>('SELECT j.value AS tag, COUNT(*) c FROM contacts c, json_each(c.tags) j WHERE c.workspace_id = ? GROUP BY j.value ORDER BY c DESC', req.ws!.id))
}))

contactRoutes.get('/contacts/export', perm('contacts.manage'), h((req, res) => {
  const { where, p } = filters(req.query as Record<string, string>, req.ws!.id)
  const rows = all<Record<string, unknown>>(`SELECT c.name, c.wa_id AS phone, c.email, c.tags, c.stage, c.deal_value, c.attributes, c.opted_out, c.created_at FROM contacts c WHERE ${where}`, ...p)
  res.set({ 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="mecgura-contacts.csv"' }).send(toCsv(rows))
}))

const contactSchema = z.object({
  name: z.string().trim().max(120).optional(), phone: z.string().min(8).max(20).optional(), email: z.string().trim().email().max(120).or(z.literal('')).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(50).optional(), attributes: z.record(z.string(), z.unknown()).optional(),
  stage: z.string().max(40).optional(), deal_value: z.number().int().min(0).optional(), owner_id: z.number().nullable().optional(),
  opted_out: z.boolean().optional(), lead_score: z.number().int().min(0).max(100).optional(),
})

contactRoutes.post('/contacts', perm('contacts.manage'), h((req, res) => {
  const b = parse(contactSchema.extend({ phone: z.string().min(8).max(20) }), req.body)
  const { contact, created } = upsertContact(req.ws!.id, b.phone, { name: b.name, email: b.email || undefined, tags: b.tags, attributes: b.attributes, stage: b.stage, source: 'manual' })
  if (!created) throw bad('A contact with this phone number already exists')
  update('contacts', contact.id, { deal_value: b.deal_value, owner_id: b.owner_id })
  res.json(get('SELECT * FROM contacts WHERE id = ?', contact.id))
}))

contactRoutes.get('/contacts/:id', perm('contacts.view'), h((req, res) => {
  const c = get('SELECT c.*, u.name AS owner_name FROM contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ? AND c.workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!c) throw notFound('Contact')
  const cid = id(req.params.id)
  res.json({
    ...c,
    notes: all('SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.contact_id = ? ORDER BY n.id DESC', cid),
    conversations: all('SELECT c.id, c.status, c.last_message_at, n.label AS number_label FROM conversations c LEFT JOIN wa_numbers n ON n.id = c.number_id WHERE c.contact_id = ?', cid),
    orders: all('SELECT * FROM orders WHERE contact_id = ? ORDER BY id DESC', cid),
    payments: all('SELECT * FROM payments WHERE contact_id = ? ORDER BY id DESC', cid),
    sequences: all('SELECT e.*, s.name FROM sequence_enrollments e JOIN sequences s ON s.id = e.sequence_id WHERE e.contact_id = ?', cid),
    campaigns: all('SELECT r.status, c.name, r.sent_at FROM campaign_recipients r JOIN campaigns c ON c.id = r.campaign_id WHERE r.contact_id = ? ORDER BY r.id DESC LIMIT 20', cid),
  })
}))

contactRoutes.patch('/contacts/:id', perm('contacts.manage'), h(async (req, res) => {
  const cid = id(req.params.id)
  const cur = get<{ tags: string[] }>('SELECT tags FROM contacts WHERE id = ? AND workspace_id = ?', cid, req.ws!.id)
  if (!cur) throw notFound('Contact')
  const b = parse(contactSchema, req.body)
  const patch: Record<string, unknown> = { ...b }
  delete patch.phone
  if (b.phone) {
    const p = normalizePhone(b.phone)
    if (!isValidPhone(p)) throw bad('Invalid phone')
    patch.wa_id = p
  }
  update('contacts', cid, patch, req.ws!.id)
  for (const t of (b.tags ?? []).filter((t) => !cur.tags.includes(t))) await onTagAdded(req.ws!.id, cid, t)
  const row = get('SELECT * FROM contacts WHERE id = ?', cid)
  emitEvent(req.ws!.id, 'contact.updated', row)
  res.json(row)
}))

contactRoutes.delete('/contacts/:id', perm('contacts.manage'), h((req, res) => {
  run('DELETE FROM contacts WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id); res.json({ ok: true })
}))

contactRoutes.post('/contacts/bulk', perm('contacts.manage'), h(async (req, res) => {
  const b = parse(z.object({ ids: z.array(z.number()).min(1).max(5000), action: z.enum(['add_tag', 'remove_tag', 'set_stage', 'delete', 'opt_out', 'opt_in', 'assign_owner', 'add_to_sequence', 'start_flow']),
    value: z.union([z.string(), z.number()]).optional() }), req.body)
  const rows = all<{ id: number; tags: string[] }>(`SELECT id, tags FROM contacts WHERE workspace_id = ? AND id IN (${b.ids.map(() => '?').join(',')})`, req.ws!.id, ...b.ids)
  const v = String(b.value ?? '')
  for (const c of rows) {
    if (b.action === 'add_tag' && v && !c.tags.includes(v)) { update('contacts', c.id, { tags: [...c.tags, v] }); await onTagAdded(req.ws!.id, c.id, v) }
    else if (b.action === 'remove_tag') update('contacts', c.id, { tags: c.tags.filter((t) => t !== v) })
    else if (b.action === 'set_stage') update('contacts', c.id, { stage: v })
    else if (b.action === 'delete') run('DELETE FROM contacts WHERE id = ?', c.id)
    else if (b.action === 'opt_out') update('contacts', c.id, { opted_out: 1 })
    else if (b.action === 'opt_in') update('contacts', c.id, { opted_out: 0 })
    else if (b.action === 'assign_owner') update('contacts', c.id, { owner_id: Number(v) || null })
    else if (b.action === 'add_to_sequence') enrollInSequence(req.ws!.id, Number(v), c.id)
    else if (b.action === 'start_flow') {
      const conv = get<{ id: number }>('SELECT id FROM conversations WHERE contact_id = ? ORDER BY last_message_at DESC LIMIT 1', c.id)
      await startFlow(Number(v), c.id, conv?.id ?? null).catch(() => undefined)
    }
  }
  res.json({ ok: true, affected: rows.length })
}))

// CSV import: columns phone (required), name, email, tags (semicolon separated), stage, plus any custom columns → attributes.
contactRoutes.post('/contacts/import', perm('contacts.manage'), h((req, res) => {
  const b = parse(z.object({ csv: z.string().min(5).max(5_000_000), tags: z.array(z.string()).optional() }), req.body)
  const rows = parseCsv(b.csv)
  if (!rows.length) throw bad('The file has no rows')
  const phoneKey = Object.keys(rows[0]).find((k) => ['phone', 'mobile', 'number', 'whatsapp', 'wa_id', 'phone number'].includes(k))
  if (!phoneKey) throw bad('CSV must have a "phone" column')
  const existing = new Set(all<{ wa_id: string }>('SELECT wa_id FROM contacts WHERE workspace_id = ?', req.ws!.id).map((r) => r.wa_id))
  const fresh = rows.filter((r) => !existing.has(normalizePhone(r[phoneKey])))
  checkLimit(req.ws!.id, 'contacts', new Set(fresh.map((r) => normalizePhone(r[phoneKey]))).size)
  let created = 0, updated = 0, invalid = 0
  tx(() => {
    for (const r of rows) {
      const phone = normalizePhone(r[phoneKey])
      if (!isValidPhone(phone)) { invalid++; continue }
      const reserved = new Set([phoneKey, 'name', 'email', 'tags', 'stage'])
      const attributes = Object.fromEntries(Object.entries(r).filter(([k, v]) => !reserved.has(k) && v))
      const tags = [...(r.tags ? r.tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : []), ...(b.tags ?? [])]
      const cur = get<{ id: number; tags: string[]; attributes: Record<string, unknown> }>('SELECT id, tags, attributes FROM contacts WHERE workspace_id = ? AND wa_id = ?', req.ws!.id, phone)
      if (cur) {
        update('contacts', cur.id, { name: r.name || undefined, email: r.email || undefined, stage: r.stage || undefined,
          tags: [...new Set([...cur.tags, ...tags])], attributes: { ...cur.attributes, ...attributes } })
        updated++
      } else {
        insert('contacts', { workspace_id: req.ws!.id, wa_id: phone, name: r.name || null, email: r.email || null, stage: r.stage || 'new', tags, attributes, source: 'import', created_at: now() })
        created++
      }
    }
  })
  res.json({ created, updated, invalid, total: rows.length })
}))

contactRoutes.post('/contacts/:id/notes', perm('contacts.view'), h((req, res) => {
  const cid = id(req.params.id)
  if (!get('SELECT id FROM contacts WHERE id = ? AND workspace_id = ?', cid, req.ws!.id)) throw notFound('Contact')
  const b = parse(z.object({ body: z.string().trim().min(1).max(4000) }), req.body)
  const nid = insert('notes', { workspace_id: req.ws!.id, contact_id: cid, user_id: req.user!.id, body: b.body, created_at: now() })
  res.json(get('SELECT n.*, u.name AS user_name FROM notes n LEFT JOIN users u ON u.id = n.user_id WHERE n.id = ?', nid))
}))
contactRoutes.delete('/notes/:id', perm('contacts.view'), h((req, res) => {
  run('DELETE FROM notes WHERE id = ? AND workspace_id = ? AND user_id = ?', id(req.params.id), req.ws!.id, req.user!.id); res.json({ ok: true })
}))

// Leads pipeline (kanban)
contactRoutes.get('/pipeline', perm('contacts.view'), h((req, res) => {
  const stages = get<{ settings: { pipeline?: string[] } }>('SELECT settings FROM workspaces WHERE id = ?', req.ws!.id)!.settings.pipeline
    ?? ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']
  const rows = all<{ stage: string }>(`SELECT c.id, c.name, c.wa_id, c.stage, c.deal_value, c.tags, c.lead_score, c.last_seen_at, u.name AS owner_name
    FROM contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE c.workspace_id = ? ORDER BY COALESCE(c.last_seen_at, c.created_at) DESC LIMIT 1000`, req.ws!.id)
  res.json({ stages, columns: stages.map((s) => ({ stage: s, contacts: rows.filter((r) => r.stage === s) })) })
}))
