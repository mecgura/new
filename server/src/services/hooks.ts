import { all, get, insert, run, now } from '../db.ts'
import { hmacHex } from '../lib/security.ts'
import { addMinutes } from '../lib/util.ts'
import { hasFeature } from './plans.ts'

export const WEBHOOK_EVENTS = [
  'message.received', 'message.sent', 'message.status', 'contact.created', 'contact.updated', 'conversation.assigned',
  'conversation.resolved', 'campaign.completed', 'order.created', 'payment.paid', 'flow.completed',
] as const

type Hook = { id: number; url: string; events: string[]; secret: string }

/** Queue an outgoing webhook delivery to every subscribed endpoint of the workspace. */
export function emitEvent(workspaceId: number, event: (typeof WEBHOOK_EVENTS)[number], data: unknown) {
  if (!hasFeature(workspaceId, 'webhooks')) return
  const hooks = all<Hook>('SELECT id, url, events, secret FROM webhooks WHERE workspace_id = ? AND is_active = 1', workspaceId)
  for (const hk of hooks) {
    if (!hk.events.includes('*') && !hk.events.includes(event)) continue
    insert('webhook_deliveries', {
      workspace_id: workspaceId, webhook_id: hk.id, event, status: 'pending', next_attempt_at: now(), created_at: now(),
      payload: JSON.stringify({ event, workspace_id: workspaceId, created_at: now(), data }),
    })
  }
}

const BACKOFF = [1, 5, 30, 120, 720] // minutes

export async function deliverPending() {
  const due = all<{ id: number; webhook_id: number; payload: string; attempts: number }>(
    "SELECT id, webhook_id, payload, attempts FROM webhook_deliveries WHERE status IN ('pending','retrying') AND next_attempt_at <= ? LIMIT 50", now())
  await Promise.all(due.map(async (d) => {
    const hk = get<Hook>('SELECT id, url, secret FROM webhooks WHERE id = ?', d.webhook_id)
    if (!hk) return
    const body = typeof d.payload === 'string' ? d.payload : JSON.stringify(d.payload)
    const ts = Math.floor(Date.now() / 1000).toString()
    let code = 0, text = ''
    try {
      const res = await fetch(hk.url, {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'MECGURA-Webhooks/1.0', 'X-Mecgura-Timestamp': ts,
          'X-Mecgura-Signature': `sha256=${hmacHex(hk.secret, `${ts}.${body}`)}` },
        body,
      })
      code = res.status; text = (await res.text()).slice(0, 500)
    } catch (e) { text = (e as Error).message }
    const attempts = d.attempts + 1
    if (code >= 200 && code < 300) {
      run("UPDATE webhook_deliveries SET status = 'delivered', status_code = ?, response = ?, attempts = ? WHERE id = ?", code, text, attempts, d.id)
      run('UPDATE webhooks SET failure_count = 0 WHERE id = ?', hk.id)
    } else {
      const giveUp = attempts >= BACKOFF.length
      run('UPDATE webhook_deliveries SET status = ?, status_code = ?, response = ?, attempts = ?, next_attempt_at = ? WHERE id = ?',
        giveUp ? 'failed' : 'retrying', code || null, text, attempts, giveUp ? null : addMinutes(BACKOFF[attempts - 1]), d.id)
      run('UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?', hk.id)
    }
  }))
}
