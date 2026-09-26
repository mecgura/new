import { all, get, insert, run, update, now, tx } from '../db.ts'
import { renderVars } from '../lib/util.ts'
import { publish } from '../lib/events.ts'
import type { OutMessage } from './whatsapp.ts'
import { sendToContact, contactContext, notify, type Contact } from './messaging.ts'
import { emitEvent } from './hooks.ts'

export type TemplateVars = { body?: string[]; header_text?: string[]; header_media?: string; buttons?: { index: number; value: string }[] }
export type Audience = { type: 'all' | 'tags' | 'stage' | 'contacts'; tags?: string[]; match?: 'any' | 'all'; stage?: string; contact_ids?: number[] }
type Tpl = { id: number; name: string; language: string; status: string; components: { type: string; format?: string; text?: string; buttons?: { type: string; url?: string }[] }[] }

/** Build a Cloud API template message for a specific contact, resolving {{name}}-style variables. */
export function buildTemplateMessage(t: Tpl, vars: TemplateVars, ctx: Record<string, unknown>): OutMessage {
  const components: unknown[] = []
  const header = t.components.find((c) => c.type === 'HEADER')
  const body = t.components.find((c) => c.type === 'BODY')
  if (header?.format === 'TEXT' && vars.header_text?.length) {
    components.push({ type: 'header', parameters: vars.header_text.map((v) => ({ type: 'text', text: renderVars(v, ctx) || '-' })) })
  } else if (header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format || '') && vars.header_media) {
    const k = header.format!.toLowerCase()
    components.push({ type: 'header', parameters: [{ type: k, [k]: { link: vars.header_media } }] })
  }
  const bodyVals = (vars.body ?? []).map((v) => renderVars(v, ctx) || '-')
  if (bodyVals.length) components.push({ type: 'body', parameters: bodyVals.map((text) => ({ type: 'text', text })) })
  for (const b of vars.buttons ?? []) {
    components.push({ type: 'button', sub_type: 'url', index: String(b.index), parameters: [{ type: 'text', text: renderVars(b.value, ctx) }] })
  }
  const preview = (body?.text ?? t.name).replace(/\{\{(\d+)\}\}/g, (_, n) => bodyVals[Number(n) - 1] ?? `{{${n}}}`)
  return { type: 'template', name: t.name, language: t.language, components, preview }
}

export function resolveAudience(workspaceId: number, a: Audience): number[] {
  const base = 'SELECT id, tags, stage FROM contacts WHERE workspace_id = ? AND opted_out = 0'
  if (a.type === 'contacts') {
    const ids = new Set(a.contact_ids ?? [])
    return all<{ id: number }>(base, workspaceId).filter((c) => ids.has(c.id)).map((c) => c.id)
  }
  const rows = all<{ id: number; tags: string[]; stage: string }>(base, workspaceId)
  if (a.type === 'stage') return rows.filter((c) => c.stage === a.stage).map((c) => c.id)
  if (a.type === 'tags') {
    const want = (a.tags ?? []).map((t) => t.toLowerCase())
    return rows.filter((c) => {
      const have = c.tags.map((t) => t.toLowerCase())
      return a.match === 'all' ? want.every((t) => have.includes(t)) : want.some((t) => have.includes(t))
    }).map((c) => c.id)
  }
  return rows.map((c) => c.id)
}

export function launchCampaign(campaignId: number) {
  const c = get<{ id: number; workspace_id: number; audience: Audience }>('SELECT * FROM campaigns WHERE id = ?', campaignId)!
  const ids = resolveAudience(c.workspace_id, c.audience)
  tx(() => {
    run('DELETE FROM campaign_recipients WHERE campaign_id = ?', c.id)
    for (const cid of ids) insert('campaign_recipients', { campaign_id: c.id, contact_id: cid, status: 'pending' })
    update('campaigns', c.id, { status: 'running', started_at: now(), total: ids.length, sent: 0, delivered: 0, read: 0, failed: 0, replied: 0 })
  })
  return ids.length
}

const BATCH = 25 // per worker tick per campaign; keeps well under Cloud API throughput limits

export async function processCampaigns() {
  const scheduled = all<{ id: number }>("SELECT id FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= ?", now())
  for (const s of scheduled) launchCampaign(s.id)

  const running = all<{ id: number; workspace_id: number; number_id: number | null; template_id: number; template_vars: TemplateVars; name: string }>(
    "SELECT * FROM campaigns WHERE status = 'running'")
  for (const c of running) {
    const tpl = get<Tpl>('SELECT * FROM templates WHERE id = ?', c.template_id)
    if (!tpl) { update('campaigns', c.id, { status: 'failed' }); continue }
    const batch = all<{ id: number; contact_id: number }>("SELECT id, contact_id FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending' LIMIT ?", c.id, BATCH)
    if (!batch.length) {
      update('campaigns', c.id, { status: 'completed', completed_at: now() })
      const done = get('SELECT * FROM campaigns WHERE id = ?', c.id)
      emitEvent(c.workspace_id, 'campaign.completed', done)
      notify(c.workspace_id, { title: `Campaign "${c.name}" completed`, link: `/app/campaigns/${c.id}`, type: 'campaign' })
      publish(c.workspace_id, 'campaign', done)
      continue
    }
    for (const r of batch) {
      const contact = get<Contact>('SELECT * FROM contacts WHERE id = ?', r.contact_id)
      if (!contact || contact.opted_out) { update('campaign_recipients', r.id, { status: 'skipped' }); continue }
      try {
        const msg = await sendToContact({ workspaceId: c.workspace_id, contactId: contact.id, numberId: c.number_id, campaignId: c.id,
          message: buildTemplateMessage(tpl, c.template_vars, contactContext(contact)), sentBy: 'campaign', marketing: true })
        const ok = msg.status !== 'failed'
        update('campaign_recipients', r.id, { status: ok ? 'sent' : 'failed', message_id: msg.id, error: msg.error, sent_at: now() })
        run(`UPDATE campaigns SET ${ok ? 'sent' : 'failed'} = ${ok ? 'sent' : 'failed'} + 1 WHERE id = ?`, c.id)
      } catch (e) {
        // Plan limit or expired subscription: pause and keep this recipient pending so "Resume" continues from here.
        if (['limit_reached', 'subscription_inactive'].includes(String((e as { code?: string }).code))) {
          update('campaigns', c.id, { status: 'paused' })
          notify(c.workspace_id, { title: `Campaign "${c.name}" paused`, body: (e as Error).message, link: `/app/campaigns/${c.id}`, type: 'campaign' })
          break
        }
        update('campaign_recipients', r.id, { status: 'failed', error: (e as Error).message })
        run('UPDATE campaigns SET failed = failed + 1 WHERE id = ?', c.id)
      }
    }
    publish(c.workspace_id, 'campaign', get('SELECT * FROM campaigns WHERE id = ?', c.id))
  }
}
