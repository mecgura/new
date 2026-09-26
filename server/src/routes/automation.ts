import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, update, now } from '../db.ts'
import { h, parse, bad, id, notFound } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { checkLimit, requireFeature } from '../services/plans.ts'
import { aiWrite } from '../services/ai.ts'
import { enrollInSequence, startFlow } from '../services/automation.ts'

export const automationRoutes = Router()
const P = perm('automation.manage')

const reply = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1).max(4096) }),
  z.object({ type: z.literal('media'), media_type: z.enum(['image', 'video', 'document']), link: z.string().url(), caption: z.string().max(1024).optional() }),
  z.object({ type: z.literal('buttons'), text: z.string().min(1).max(1024), buttons: z.array(z.string().max(20)).min(1).max(3), footer: z.string().max(60).optional() }),
  z.object({ type: z.literal('list'), text: z.string().min(1).max(1024), button: z.string().max(20), items: z.array(z.string().max(24)).min(1).max(10) }),
  z.object({ type: z.literal('cta_url'), text: z.string().min(1).max(1024), display_text: z.string().max(20), url: z.string().min(4) }),
  z.object({ type: z.literal('template'), name: z.string(), language: z.string(), components: z.array(z.unknown()).optional() }),
])

// ---- Keyword chatbot rules ----
automationRoutes.get('/bot-rules', P, h((req, res) => { res.json(all('SELECT * FROM bot_rules WHERE workspace_id = ? ORDER BY priority DESC, id', req.ws!.id)) }))
const ruleSchema = z.object({ name: z.string().trim().min(1).max(80), match_type: z.enum(['exact', 'contains', 'starts', 'regex', 'any']),
  keywords: z.array(z.string().max(100)).max(50), reply, priority: z.number().int().min(0).max(100).default(0), is_active: z.boolean().default(true) })
automationRoutes.post('/bot-rules', P, h((req, res) => {
  const b = parse(ruleSchema, req.body)
  res.json(get('SELECT * FROM bot_rules WHERE id = ?', insert('bot_rules', { workspace_id: req.ws!.id, ...b, created_at: now() })))
}))
automationRoutes.put('/bot-rules/:id', P, h((req, res) => {
  const b = parse(ruleSchema.partial(), req.body)
  update('bot_rules', id(req.params.id), b, req.ws!.id)
  res.json(get('SELECT * FROM bot_rules WHERE id = ?', id(req.params.id)))
}))
automationRoutes.delete('/bot-rules/:id', P, h((req, res) => { run('DELETE FROM bot_rules WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id); res.json({ ok: true }) }))

// ---- Flows (visual workflow builder) ----
const nodeSchema = z.object({
  id: z.string().min(1).max(40), type: z.enum(['message', 'question', 'buttons', 'condition', 'action', 'delay', 'webhook', 'ai', 'handoff', 'end']),
  data: z.record(z.string(), z.unknown()).default({}), next: z.string().nullable().optional(), branches: z.record(z.string(), z.string().nullable()).optional(),
  x: z.number().optional(), y: z.number().optional(),
})
const flowSchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().max(500).optional(),
  trigger: z.object({ type: z.enum(['keyword', 'new_contact', 'any_message', 'tag_added', 'manual', 'api']), value: z.string().max(500).optional(), match: z.enum(['exact', 'contains', 'starts']).optional() }),
  nodes: z.array(nodeSchema).max(200), is_active: z.boolean().optional() })

function validateFlow(nodes: z.infer<typeof nodeSchema>[]) {
  const ids = new Set(nodes.map((n) => n.id))
  if (ids.size !== nodes.length) throw bad('Two steps have the same id')
  for (const n of nodes) {
    for (const t of [n.next, ...Object.values(n.branches ?? {})]) if (t && !ids.has(t)) throw bad(`Step "${n.id}" points to a missing step "${t}"`)
    if (n.type === 'message') parse(reply, n.data.reply)
    if (n.type === 'webhook' && !/^https?:\/\//.test(String(n.data.url || ''))) throw bad(`Step "${n.id}" needs a valid webhook URL`)
  }
}

automationRoutes.get('/flows', P, h((req, res) => { res.json(all('SELECT id, name, description, trigger, is_active, runs, completions, updated_at, created_at, json_array_length(nodes) AS steps FROM flows WHERE workspace_id = ? ORDER BY id DESC', req.ws!.id)) }))
automationRoutes.get('/flows/:id', P, h((req, res) => {
  const f = get('SELECT * FROM flows WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!f) throw notFound('Flow')
  res.json(f)
}))
automationRoutes.post('/flows', P, h((req, res) => {
  requireFeature(req.ws!.id, 'flows'); checkLimit(req.ws!.id, 'flows')
  const b = parse(flowSchema, req.body)
  validateFlow(b.nodes)
  res.json(get('SELECT * FROM flows WHERE id = ?', insert('flows', { workspace_id: req.ws!.id, ...b, is_active: b.is_active ?? false, created_at: now(), updated_at: now() })))
}))
automationRoutes.put('/flows/:id', P, h((req, res) => {
  const b = parse(flowSchema.partial(), req.body)
  if (b.nodes) validateFlow(b.nodes)
  if (b.is_active && b.nodes && !b.nodes.length) throw bad('Add at least one step before activating')
  update('flows', id(req.params.id), { ...b, updated_at: now() }, req.ws!.id)
  res.json(get('SELECT * FROM flows WHERE id = ?', id(req.params.id)))
}))
automationRoutes.post('/flows/:id/duplicate', P, h((req, res) => {
  checkLimit(req.ws!.id, 'flows')
  const f = get<{ name: string; description: string; trigger: unknown; nodes: unknown }>('SELECT * FROM flows WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!f) throw notFound('Flow')
  res.json(get('SELECT * FROM flows WHERE id = ?', insert('flows', { workspace_id: req.ws!.id, name: `${f.name} (copy)`, description: f.description, trigger: f.trigger, nodes: f.nodes, is_active: 0, created_at: now(), updated_at: now() })))
}))
automationRoutes.post('/flows/:id/test', P, h(async (req, res) => {
  const b = parse(z.object({ contact_id: z.number() }), req.body)
  if (!get('SELECT id FROM contacts WHERE id = ? AND workspace_id = ?', b.contact_id, req.ws!.id)) throw notFound('Contact')
  const conv = get<{ id: number }>('SELECT id FROM conversations WHERE contact_id = ? ORDER BY last_message_at DESC LIMIT 1', b.contact_id)
  await startFlow(id(req.params.id), b.contact_id, conv?.id ?? null)
  res.json({ ok: true })
}))
automationRoutes.get('/flows/:id/runs', P, h((req, res) => {
  res.json(all('SELECT r.*, c.name, c.wa_id FROM flow_runs r JOIN contacts c ON c.id = r.contact_id WHERE r.flow_id = ? AND r.workspace_id = ? ORDER BY r.id DESC LIMIT 100', id(req.params.id), req.ws!.id))
}))
automationRoutes.delete('/flows/:id', P, h((req, res) => { run('DELETE FROM flows WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id); res.json({ ok: true }) }))

// ---- Follow-up sequences ----
const seqSchema = z.object({ name: z.string().trim().min(1).max(100), trigger: z.object({ type: z.enum(['manual', 'tag_added']), value: z.string().optional() }),
  steps: z.array(z.object({ delay_minutes: z.number().int().min(0).max(60 * 24 * 90), reply })).min(1).max(30), is_active: z.boolean().default(true), stop_on_reply: z.boolean().default(true) })
automationRoutes.get('/sequences', P, h((req, res) => {
  res.json(all(`SELECT s.*, (SELECT COUNT(*) FROM sequence_enrollments e WHERE e.sequence_id = s.id AND e.status = 'active') AS active_count,
    (SELECT COUNT(*) FROM sequence_enrollments e WHERE e.sequence_id = s.id) AS total_count FROM sequences s WHERE s.workspace_id = ? ORDER BY s.id DESC`, req.ws!.id))
}))
automationRoutes.post('/sequences', P, h((req, res) => {
  requireFeature(req.ws!.id, 'sequences')
  const b = parse(seqSchema, req.body)
  res.json(get('SELECT * FROM sequences WHERE id = ?', insert('sequences', { workspace_id: req.ws!.id, ...b, created_at: now() })))
}))
automationRoutes.put('/sequences/:id', P, h((req, res) => {
  update('sequences', id(req.params.id), parse(seqSchema.partial(), req.body), req.ws!.id)
  res.json(get('SELECT * FROM sequences WHERE id = ?', id(req.params.id)))
}))
automationRoutes.post('/sequences/:id/enroll', P, h((req, res) => {
  const b = parse(z.object({ contact_ids: z.array(z.number()).min(1).max(5000) }), req.body)
  let n = 0
  for (const c of b.contact_ids) if (get('SELECT id FROM contacts WHERE id = ? AND workspace_id = ? AND opted_out = 0', c, req.ws!.id) && enrollInSequence(req.ws!.id, id(req.params.id), c)) n++
  res.json({ enrolled: n })
}))
automationRoutes.delete('/sequences/:id', P, h((req, res) => { run('DELETE FROM sequences WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id); res.json({ ok: true }) }))

// ---- AI assistant ----
automationRoutes.post('/ai/write', perm('inbox.reply'), h(async (req, res) => {
  requireFeature(req.ws!.id, 'ai')
  const b = parse(z.object({ kind: z.enum(['template', 'rewrite', 'broadcast']), brief: z.string().min(3).max(3000), tone: z.string().max(80).optional() }), req.body)
  res.json({ text: await aiWrite(req.ws!.id, b.kind, b.brief, b.tone) })
}))
