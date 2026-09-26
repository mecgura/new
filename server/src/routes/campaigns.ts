import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, update, now } from '../db.ts'
import { h, parse, bad, id, notFound } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { launchCampaign, resolveAudience, type Audience } from '../services/campaigns.ts'
import { checkLimit, addUsage } from '../services/plans.ts'
import { getNumber } from '../services/messaging.ts'
import { assertCanSend } from '../services/subscription.ts'

export const campaignRoutes = Router()

campaignRoutes.get('/campaigns', perm('campaigns.manage'), h((req, res) => {
  res.json(all('SELECT c.*, t.name AS template_name, u.name AS created_by_name FROM campaigns c LEFT JOIN templates t ON t.id = c.template_id LEFT JOIN users u ON u.id = c.created_by WHERE c.workspace_id = ? ORDER BY c.id DESC', req.ws!.id))
}))

const audienceSchema = z.object({ type: z.enum(['all', 'tags', 'stage', 'contacts']), tags: z.array(z.string()).optional(), match: z.enum(['any', 'all']).optional(),
  stage: z.string().optional(), contact_ids: z.array(z.number()).optional() })

campaignRoutes.post('/campaigns/audience-preview', perm('campaigns.manage'), h((req, res) => {
  const a = parse(audienceSchema, req.body)
  res.json({ count: resolveAudience(req.ws!.id, a as Audience).length })
}))

campaignRoutes.post('/campaigns', perm('campaigns.manage'), h((req, res) => {
  const b = parse(z.object({
    name: z.string().trim().min(2).max(100), template_id: z.number(), number_id: z.number().optional(),
    template_vars: z.object({ body: z.array(z.string()).optional(), header_text: z.array(z.string()).optional(), header_media: z.string().optional(),
      buttons: z.array(z.object({ index: z.number(), value: z.string() })).optional() }).default({}),
    audience: audienceSchema, send: z.enum(['draft', 'now', 'schedule']), scheduled_at: z.string().optional(),
  }), req.body)
  const t = get<{ status: string }>('SELECT status FROM templates WHERE id = ? AND workspace_id = ?', b.template_id, req.ws!.id)
  if (!t) throw bad('Template not found')
  if (b.send !== 'draft' && t.status !== 'APPROVED') throw bad('The template must be approved by Meta before sending')
  const num = getNumber(req.ws!.id, b.number_id)
  const count = resolveAudience(req.ws!.id, b.audience as Audience).length
  if (b.send !== 'draft') {
    assertCanSend(req.ws!.id)
    if (!count) throw bad('The selected audience has no contacts (opted-out contacts are excluded)')
    checkLimit(req.ws!.id, 'campaigns'); checkLimit(req.ws!.id, 'messages', count)
  }
  if (b.send === 'schedule' && (!b.scheduled_at || new Date(b.scheduled_at) <= new Date())) throw bad('Pick a future date & time')
  const cid = insert('campaigns', { workspace_id: req.ws!.id, number_id: num.id, name: b.name, template_id: b.template_id, template_vars: b.template_vars,
    audience: b.audience, status: b.send === 'schedule' ? 'scheduled' : 'draft', scheduled_at: b.send === 'schedule' ? new Date(b.scheduled_at!).toISOString() : null,
    total: count, created_by: req.user!.id, created_at: now() })
  if (b.send !== 'draft') addUsage(req.ws!.id, 'campaigns')
  if (b.send === 'now') launchCampaign(cid)
  res.json(get('SELECT * FROM campaigns WHERE id = ?', cid))
}))

campaignRoutes.get('/campaigns/:id', perm('campaigns.manage'), h((req, res) => {
  const c = get('SELECT c.*, t.name AS template_name, t.components FROM campaigns c LEFT JOIN templates t ON t.id = c.template_id WHERE c.id = ? AND c.workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!c) throw notFound('Campaign')
  const recipients = all(`SELECT r.*, ct.name, ct.wa_id, m.status AS message_status FROM campaign_recipients r JOIN contacts ct ON ct.id = r.contact_id
    LEFT JOIN messages m ON m.id = r.message_id WHERE r.campaign_id = ? ORDER BY r.id LIMIT 500`, id(req.params.id))
  res.json({ ...c, recipients })
}))

campaignRoutes.post('/campaigns/:id/:action', perm('campaigns.manage'), h((req, res) => {
  const c = get<{ id: number; status: string; total: number }>('SELECT * FROM campaigns WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!c) throw notFound('Campaign')
  const a = req.params.action
  if (a === 'pause' && c.status === 'running') update('campaigns', c.id, { status: 'paused' })
  else if (a === 'resume' && c.status === 'paused') { assertCanSend(req.ws!.id); update('campaigns', c.id, { status: 'running' }) }
  else if (a === 'cancel' && ['scheduled', 'running', 'paused'].includes(c.status)) {
    update('campaigns', c.id, { status: 'cancelled', completed_at: now() })
    run("UPDATE campaign_recipients SET status = 'cancelled' WHERE campaign_id = ? AND status = 'pending'", c.id)
  } else if (a === 'send' && c.status === 'draft') {
    assertCanSend(req.ws!.id)
    checkLimit(req.ws!.id, 'campaigns'); addUsage(req.ws!.id, 'campaigns')
    if (!launchCampaign(c.id)) throw bad('The audience has no contacts')
  } else throw bad(`Cannot ${a} a ${c.status} campaign`)
  res.json(get('SELECT * FROM campaigns WHERE id = ?', c.id))
}))

campaignRoutes.delete('/campaigns/:id', perm('campaigns.manage'), h((req, res) => {
  run("DELETE FROM campaigns WHERE id = ? AND workspace_id = ? AND status IN ('draft','completed','cancelled','failed','scheduled')", id(req.params.id), req.ws!.id)
  res.json({ ok: true })
}))
