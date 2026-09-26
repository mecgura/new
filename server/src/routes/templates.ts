import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, update, now } from '../db.ts'
import { h, parse, bad, id, notFound } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { getNumber } from '../services/messaging.ts'
import * as wa from '../services/whatsapp.ts'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.ts'

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.3gp': 'video/3gpp', '.pdf': 'application/pdf' }

/** Reads a file previously uploaded through /api/uploads, from its public URL. */
function localUpload(url: string) {
  const name = url.split('/uploads/')[1]
  if (!name || !/^[a-f0-9]{24}\.[a-z0-9]{1,6}$/.test(name)) throw bad('Upload the header media file again')
  const file = path.join(config.dataDir, 'uploads', name)
  if (!fs.existsSync(file)) throw bad('Header media file not found — upload it again')
  const mime = MIME[path.extname(name)]
  if (!mime) throw bad('Header media must be JPG, PNG, MP4 or PDF')
  return { buffer: fs.readFileSync(file), mime }
}

export const templateRoutes = Router()

templateRoutes.get('/templates', h((req, res) => {
  const q = req.query as Record<string, string>
  res.json(all(`SELECT * FROM templates WHERE workspace_id = ? ${q.status ? 'AND status = ?' : ''} ORDER BY updated_at DESC, id DESC`, req.ws!.id, ...(q.status ? [q.status] : [])))
}))

const component = z.object({
  type: z.enum(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']), format: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION']).optional(),
  text: z.string().max(1024).optional(), example: z.record(z.string(), z.unknown()).optional(),
  buttons: z.array(z.object({ type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE']), text: z.string().max(25).optional(),
    url: z.string().max(2000).optional(), phone_number: z.string().max(20).optional(), example: z.array(z.string()).optional() })).max(10).optional(),
})

templateRoutes.post('/templates', perm('templates.manage'), h(async (req, res) => {
  const b = parse(z.object({
    name: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,512}$/, 'Name may only contain lowercase letters, numbers and underscores'),
    language: z.string().min(2).max(10), category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']), components: z.array(component).min(1), number_id: z.number().optional(),
    header_media_url: z.string().url().optional(),
  }), req.body)
  const body = b.components.find((c) => c.type === 'BODY')
  if (!body?.text) throw bad('Template body text is required')
  if (get('SELECT id FROM templates WHERE workspace_id = ? AND name = ? AND language = ?', req.ws!.id, b.name, b.language)) throw bad('A template with this name and language already exists')
  const num = getNumber(req.ws!.id, b.number_id)
  const header = b.components.find((c) => c.type === 'HEADER')
  if (header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format ?? '')) {
    if (b.header_media_url) {
      const { buffer, mime } = localUpload(b.header_media_url)
      if (header.format === 'IMAGE' && !mime.startsWith('image/')) throw bad('Header is IMAGE — upload a JPG or PNG')
      if (header.format === 'VIDEO' && !mime.startsWith('video/')) throw bad('Header is VIDEO — upload an MP4')
      if (header.format === 'DOCUMENT' && mime !== 'application/pdf') throw bad('Header is DOCUMENT — upload a PDF')
      try { header.example = { header_handle: [await wa.uploadTemplateSample(num, buffer, mime)] } } catch (e) { throw bad(`Media upload to Meta failed: ${(e as Error).message}`) }
    } else if (!(header.example as { header_handle?: unknown[] } | undefined)?.header_handle?.length) {
      throw bad(`Upload a sample ${header.format!.toLowerCase()} for the header — Meta needs it to review the template`)
    }
  }
  let result: { id: string; status: string }
  try { result = await wa.createTemplate(num, { name: b.name, language: b.language, category: b.category, components: b.components }) }
  catch (e) { throw bad(`Meta rejected the template: ${(e as Error).message}`) }
  const tid = insert('templates', { workspace_id: req.ws!.id, number_id: num.id, name: b.name, language: b.language, category: b.category,
    components: b.components, status: result.status || 'PENDING', wa_template_id: result.id, created_at: now(), updated_at: now() })
  res.json(get('SELECT * FROM templates WHERE id = ?', tid))
}))

templateRoutes.post('/templates/sync', perm('templates.manage'), h(async (req, res) => {
  const nums = all<wa.WaNumber>('SELECT * FROM wa_numbers WHERE workspace_id = ? AND is_demo = 0', req.ws!.id)
  let synced = 0
  const seenWaba = new Set<string>()
  for (const num of nums) {
    if (!num.waba_id || seenWaba.has(num.waba_id)) continue
    seenWaba.add(num.waba_id)
    const list = await wa.listTemplates(num)
    for (const t of list as { id: string; name: string; language: string; status: string; category: string; components: unknown[]; rejected_reason?: string }[]) {
      const cur = get<{ id: number }>('SELECT id FROM templates WHERE workspace_id = ? AND name = ? AND language = ?', req.ws!.id, t.name, t.language)
      const data = { status: t.status, category: t.category, components: t.components, wa_template_id: t.id, number_id: num.id,
        rejection_reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null, updated_at: now() }
      if (cur) update('templates', cur.id, data); else insert('templates', { workspace_id: req.ws!.id, name: t.name, language: t.language, created_at: now(), ...data })
      synced++
    }
  }
  res.json({ synced })
}))

templateRoutes.delete('/templates/:id', perm('templates.manage'), h(async (req, res) => {
  const t = get<{ id: number; name: string; number_id: number | null }>('SELECT * FROM templates WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!t) throw notFound('Template')
  const num = t.number_id ? get<wa.WaNumber>('SELECT * FROM wa_numbers WHERE id = ?', t.number_id) : undefined
  if (num) await wa.deleteTemplate(num, t.name).catch(() => undefined)
  run('DELETE FROM templates WHERE id = ?', t.id)
  res.json({ ok: true })
}))
