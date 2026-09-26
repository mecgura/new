import { all, get, insert, run, update, now, tx } from '../db.ts'
import { config } from '../config.ts'
import { randomToken } from '../lib/security.ts'
import { publish } from '../lib/events.ts'
import { sendMail, renderHtml } from './email.ts'
import { addUsage } from './plans.ts'
import { contactContext, notify, type Contact } from './messaging.ts'
import type { Audience } from './campaigns.ts'

/** Contacts that can receive marketing email: have an address and did not unsubscribe. */
export function resolveEmailAudience(workspaceId: number, a: Audience): number[] {
  const rows = all<{ id: number; tags: string[]; stage: string }>(
    "SELECT id, tags, stage FROM contacts WHERE workspace_id = ? AND email IS NOT NULL AND email != '' AND COALESCE(email_opted_out, 0) = 0", workspaceId)
  if (a.type === 'contacts') { const ids = new Set(a.contact_ids ?? []); return rows.filter((c) => ids.has(c.id)).map((c) => c.id) }
  if (a.type === 'stage') return rows.filter((c) => c.stage === a.stage).map((c) => c.id)
  if (a.type === 'tags') {
    const want = (a.tags ?? []).map((t) => t.toLowerCase())
    return rows.filter((c) => { const have = c.tags.map((t) => t.toLowerCase()); return a.match === 'all' ? want.every((t) => have.includes(t)) : want.some((t) => have.includes(t)) }).map((c) => c.id)
  }
  return rows.map((c) => c.id)
}

export function launchEmailCampaign(campaignId: number) {
  const c = get<{ id: number; workspace_id: number; audience: Audience }>('SELECT * FROM email_campaigns WHERE id = ?', campaignId)!
  const ids = resolveEmailAudience(c.workspace_id, c.audience)
  tx(() => {
    run('DELETE FROM email_recipients WHERE campaign_id = ?', c.id)
    for (const cid of ids) {
      const email = get<{ email: string }>('SELECT email FROM contacts WHERE id = ?', cid)!.email
      insert('email_recipients', { campaign_id: c.id, contact_id: cid, email, token: randomToken(16), status: 'pending' })
    }
    update('email_campaigns', c.id, { status: 'running', started_at: now(), total: ids.length, sent: 0, failed: 0, opened: 0 })
  })
  return ids.length
}

const trackingBase = () => config.apiUrl

/** Adds the open pixel and makes sure every marketing email has a working unsubscribe link. */
export function finalizeCampaignHtml(html: string, token: string) {
  const unsub = `${trackingBase()}/e/u/${token}`
  let out = html.includes('{{unsubscribe_url}}') ? html : html.replace(/<\/body>/i, (m) => `${footer(unsub)}${m}`)
  if (out === html && !html.includes('{{unsubscribe_url}}')) out = html + footer(unsub)
  const pixel = `<img src="${trackingBase()}/e/o/${token}" width="1" height="1" alt="" style="display:none">`
  return { html: /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${pixel}</body>`) : out + pixel, unsub }
}
const footer = (url: string) => `<p style="font-size:12px;color:#8a9aa3;text-align:center;margin:24px 0">Don't want these emails? <a href="${url}" style="color:#8a9aa3">Unsubscribe</a></p>`

const BATCH = 20

export async function processEmailCampaigns() {
  for (const s of all<{ id: number }>("SELECT id FROM email_campaigns WHERE status = 'scheduled' AND scheduled_at <= ?", now())) launchEmailCampaign(s.id)
  const running = all<{ id: number; workspace_id: number; template_id: number; subject: string | null; name: string }>("SELECT * FROM email_campaigns WHERE status = 'running'")
  for (const c of running) {
    const tpl = get<{ subject: string; html: string }>('SELECT subject, html FROM email_templates WHERE id = ?', c.template_id)
    if (!tpl) { update('email_campaigns', c.id, { status: 'failed' }); continue }
    const batch = all<{ id: number; contact_id: number; email: string; token: string }>("SELECT * FROM email_recipients WHERE campaign_id = ? AND status = 'pending' LIMIT ?", c.id, BATCH)
    if (!batch.length) {
      update('email_campaigns', c.id, { status: 'completed', completed_at: now() })
      notify(c.workspace_id, { title: `Email campaign "${c.name}" completed`, link: '/app/email', type: 'campaign' })
      continue
    }
    for (const r of batch) {
      const contact = get<Contact & { email_opted_out: number }>('SELECT * FROM contacts WHERE id = ?', r.contact_id)
      if (!contact || contact.email_opted_out) { update('email_recipients', r.id, { status: 'skipped' }); continue }
      const { html, unsub } = finalizeCampaignHtml(tpl.html, r.token)
      const ctx = { ...contactContext(contact), unsubscribe_url: unsub }
      try {
        await sendMail('workspace', { workspaceId: c.workspace_id, to: r.email, subject: renderHtml(c.subject || tpl.subject, ctx).replace(/&amp;/g, '&'), html: renderHtml(html, ctx),
          kind: 'campaign', headers: { 'List-Unsubscribe': `<${unsub}>` } })
        update('email_recipients', r.id, { status: 'sent', sent_at: now() })
        run('UPDATE email_campaigns SET sent = sent + 1 WHERE id = ?', c.id)
        addUsage(c.workspace_id, 'emails')
      } catch (e) {
        update('email_recipients', r.id, { status: 'failed', error: (e as Error).message.slice(0, 300) })
        run('UPDATE email_campaigns SET failed = failed + 1 WHERE id = ?', c.id)
        if (/not configured|Connect your email/.test((e as Error).message)) { update('email_campaigns', c.id, { status: 'paused' }); break }
      }
    }
    publish(c.workspace_id, 'campaign', { email_campaign: c.id })
  }
}
