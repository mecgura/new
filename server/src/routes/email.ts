import { Router } from 'express'
import { z } from 'zod'
import { all, get, insert, run, update, now } from '../db.ts'
import { h, parse, bad, id, notFound } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'
import { sendMail, renderHtml, workspaceSmtp } from '../services/email.ts'
import { launchEmailCampaign, resolveEmailAudience, finalizeCampaignHtml } from '../services/emailCampaigns.ts'
import { contactContext, type Contact } from '../services/messaging.ts'
import type { Audience } from '../services/campaigns.ts'

export const emailRoutes = Router()
const P = perm('campaigns.manage')

emailRoutes.get('/email/status', P, h((req, res) => {
  const s = workspaceSmtp(req.ws!.id)
  res.json({ connected: !!s, from: s?.from ?? null,
    contacts_with_email: Number(get<{ c: number }>("SELECT COUNT(*) c FROM contacts WHERE workspace_id = ? AND email IS NOT NULL AND email != '' AND COALESCE(email_opted_out,0) = 0", req.ws!.id)!.c) })
}))

// ---- Templates (raw HTML) ----
const tplSchema = z.object({ name: z.string().trim().min(1).max(100), subject: z.string().max(200), html: z.string().max(500_000) })
emailRoutes.get('/email/templates', P, h((req, res) => { res.json(all('SELECT * FROM email_templates WHERE workspace_id = ? ORDER BY id DESC', req.ws!.id)) }))
emailRoutes.post('/email/templates', P, h((req, res) => {
  const b = parse(tplSchema, req.body)
  res.json(get('SELECT * FROM email_templates WHERE id = ?', insert('email_templates', { workspace_id: req.ws!.id, ...b, created_at: now(), updated_at: now() })))
}))
emailRoutes.put('/email/templates/:id', P, h((req, res) => {
  update('email_templates', id(req.params.id), { ...parse(tplSchema.partial(), req.body), updated_at: now() }, req.ws!.id)
  res.json(get('SELECT * FROM email_templates WHERE id = ?', id(req.params.id)))
}))
emailRoutes.delete('/email/templates/:id', P, h((req, res) => { run('DELETE FROM email_templates WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id); res.json({ ok: true }) }))

emailRoutes.post('/email/test', P, h(async (req, res) => {
  const b = parse(z.object({ to: z.string().email(), template_id: z.number().optional(), subject: z.string().optional(), html: z.string().optional() }), req.body)
  const tpl = b.template_id ? get<{ subject: string; html: string }>('SELECT subject, html FROM email_templates WHERE id = ? AND workspace_id = ?', b.template_id, req.ws!.id) : undefined
  const html = b.html ?? tpl?.html ?? '<p>This is a test email from MECGURA WhatsApp. Your email account is connected ✅</p>'
  const ctx = { name: 'Test Customer', first_name: 'Test', email: b.to, phone: '919999999999', unsubscribe_url: '#' }
  await sendMail('workspace', { workspaceId: req.ws!.id, to: b.to, subject: `[Test] ${renderHtml(b.subject ?? tpl?.subject ?? 'Email connected', ctx)}`, html: renderHtml(html, ctx), kind: 'test' })
  res.json({ ok: true })
}))

// ---- Campaigns ----
const audienceSchema = z.object({ type: z.enum(['all', 'tags', 'stage', 'contacts']), tags: z.array(z.string()).optional(), match: z.enum(['any', 'all']).optional(),
  stage: z.string().optional(), contact_ids: z.array(z.number()).optional() })
emailRoutes.get('/email/campaigns', P, h((req, res) => {
  res.json(all('SELECT c.*, t.name AS template_name FROM email_campaigns c LEFT JOIN email_templates t ON t.id = c.template_id WHERE c.workspace_id = ? ORDER BY c.id DESC', req.ws!.id))
}))
emailRoutes.post('/email/campaigns/audience-preview', P, h((req, res) => { res.json({ count: resolveEmailAudience(req.ws!.id, parse(audienceSchema, req.body) as Audience).length }) }))
emailRoutes.post('/email/campaigns', P, h((req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(100), template_id: z.number(), subject: z.string().max(200).optional(), audience: audienceSchema,
    send: z.enum(['draft', 'now', 'schedule']), scheduled_at: z.string().optional() }), req.body)
  if (!get('SELECT id FROM email_templates WHERE id = ? AND workspace_id = ?', b.template_id, req.ws!.id)) throw bad('Template not found')
  const count = resolveEmailAudience(req.ws!.id, b.audience as Audience).length
  if (b.send !== 'draft') {
    if (!workspaceSmtp(req.ws!.id)) throw bad('Connect your email account in Settings → Integrations → Email first')
    if (!count) throw bad('No contacts with an email address in this audience')
  }
  if (b.send === 'schedule' && (!b.scheduled_at || new Date(b.scheduled_at) <= new Date())) throw bad('Pick a future date & time')
  const cid = insert('email_campaigns', { workspace_id: req.ws!.id, name: b.name, template_id: b.template_id, subject: b.subject || null, audience: b.audience,
    status: b.send === 'schedule' ? 'scheduled' : 'draft', scheduled_at: b.send === 'schedule' ? new Date(b.scheduled_at!).toISOString() : null, total: count, created_by: req.user!.id, created_at: now() })
  if (b.send === 'now') launchEmailCampaign(cid)
  res.json(get('SELECT * FROM email_campaigns WHERE id = ?', cid))
}))
emailRoutes.get('/email/campaigns/:id', P, h((req, res) => {
  const c = get('SELECT c.*, t.name AS template_name FROM email_campaigns c LEFT JOIN email_templates t ON t.id = c.template_id WHERE c.id = ? AND c.workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!c) throw notFound('Campaign')
  res.json({ ...c, recipients: all('SELECT r.id, r.email, r.status, r.error, r.sent_at, r.opened_at, ct.name FROM email_recipients r JOIN contacts ct ON ct.id = r.contact_id WHERE r.campaign_id = ? ORDER BY r.id LIMIT 500', id(req.params.id)) })
}))
emailRoutes.post('/email/campaigns/:id/:action', P, h((req, res) => {
  const c = get<{ id: number; status: string }>('SELECT * FROM email_campaigns WHERE id = ? AND workspace_id = ?', id(req.params.id), req.ws!.id)
  if (!c) throw notFound('Campaign')
  const a = req.params.action
  if (a === 'send' && c.status === 'draft') { if (!workspaceSmtp(req.ws!.id)) throw bad('Connect your email account first'); if (!launchEmailCampaign(c.id)) throw bad('No recipients') }
  else if (a === 'pause' && c.status === 'running') update('email_campaigns', c.id, { status: 'paused' })
  else if (a === 'resume' && c.status === 'paused') update('email_campaigns', c.id, { status: 'running' })
  else if (a === 'cancel' && ['scheduled', 'running', 'paused'].includes(c.status)) update('email_campaigns', c.id, { status: 'cancelled', completed_at: now() })
  else throw bad(`Cannot ${a} a ${c.status} campaign`)
  res.json(get('SELECT * FROM email_campaigns WHERE id = ?', c.id))
}))
emailRoutes.delete('/email/campaigns/:id', P, h((req, res) => {
  run("DELETE FROM email_campaigns WHERE id = ? AND workspace_id = ? AND status IN ('draft','completed','cancelled','failed','scheduled')", id(req.params.id), req.ws!.id); res.json({ ok: true })
}))

emailRoutes.post('/email/preview', P, h((req, res) => {
  const b = parse(z.object({ html: z.string().max(500_000), contact_id: z.number().optional() }), req.body)
  const contact = b.contact_id ? get<Contact>('SELECT * FROM contacts WHERE id = ? AND workspace_id = ?', b.contact_id, req.ws!.id) : undefined
  const { html } = finalizeCampaignHtml(b.html, 'preview')
  res.json({ html: renderHtml(html, { ...(contact ? contactContext(contact) : { name: 'Aman Sharma', first_name: 'Aman', email: 'aman@example.com' }), unsubscribe_url: '#' }) })
}))

emailRoutes.get('/email/log', P, h((req, res) => { res.json(all('SELECT * FROM email_log WHERE workspace_id = ? ORDER BY id DESC LIMIT 100', req.ws!.id)) }))

// Public tracking endpoints (mounted at /e)
export const emailTracking = Router()
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
emailTracking.get('/o/:token', (req, res) => {
  const r = get<{ id: number; campaign_id: number; opened_at: string | null }>('SELECT id, campaign_id, opened_at FROM email_recipients WHERE token = ?', req.params.token)
  if (r && !r.opened_at) { run('UPDATE email_recipients SET opened_at = ? WHERE id = ?', now(), r.id); run('UPDATE email_campaigns SET opened = opened + 1 WHERE id = ?', r.campaign_id) }
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' }).send(GIF)
})
emailTracking.get('/u/:token', (req, res) => {
  const r = get<{ id: number; campaign_id: number; contact_id: number }>('SELECT id, campaign_id, contact_id FROM email_recipients WHERE token = ?', req.params.token)
  if (r) {
    const changed = run('UPDATE contacts SET email_opted_out = 1 WHERE id = ? AND COALESCE(email_opted_out,0) = 0', r.contact_id)
    if (Number(changed.changes)) run('UPDATE email_campaigns SET unsubscribed = unsubscribed + 1 WHERE id = ?', r.campaign_id)
  }
  res.set('Content-Type', 'text/html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial;background:#f3f6f5;display:grid;place-items:center;min-height:90vh;margin:0"><div style="background:#fff;padding:32px;border-radius:16px;max-width:420px;text-align:center"><h2 style="margin:0 0 8px">You're unsubscribed</h2><p style="color:#556">You won't receive marketing emails from this business anymore.</p></div></body>`)
})
