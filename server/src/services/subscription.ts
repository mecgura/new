import fs from 'node:fs'
import path from 'node:path'
import { all, db, get, run, now } from '../db.ts'
import { config } from '../config.ts'
import { HttpError } from '../lib/http.ts'
import { notify } from './messaging.ts'

// Paid plans keep working for a few days after the period ends so a late renewal does not cut customers off.
export const GRACE_DAYS = 3

type Sub = { subscription_status: string; current_period_end: string | null; trial_ends_at: string | null; status: string }

export function subscriptionState(workspaceId: number) {
  const w = get<Sub>('SELECT subscription_status, current_period_end, trial_ends_at, status FROM workspaces WHERE id = ?', workspaceId)
  if (!w) return { canSend: false, reason: 'Workspace not found' }
  if (w.status === 'suspended') return { canSend: false, reason: `This workspace is suspended. Contact MECGURA at ${config.brand.email}.` }
  if (['expired', 'cancelled'].includes(w.subscription_status)) {
    return { canSend: false, reason: `Your ${w.subscription_status === 'expired' ? 'free trial or plan has expired' : 'plan was cancelled'}. Renew in Plan & Billing or contact ${config.brand.phone}.` }
  }
  return { canSend: true, reason: '' }
}

/** Blocks outgoing messages when the plan is not active. Incoming messages are still received and stored. */
export function assertCanSend(workspaceId: number) {
  const s = subscriptionState(workspaceId)
  if (!s.canSend) throw new HttpError(402, s.reason, 'subscription_inactive')
}

/** Moves trials and unpaid plans to expired, and warns owners a few days before. */
export function enforceSubscriptions() {
  const t = now()
  const expiredTrials = all<{ id: number }>("SELECT id FROM workspaces WHERE subscription_status = 'trialing' AND trial_ends_at IS NOT NULL AND trial_ends_at < ?", t)
  const graceCutoff = new Date(Date.now() - GRACE_DAYS * 86400000).toISOString()
  const pastDue = all<{ id: number }>("SELECT id FROM workspaces WHERE subscription_status = 'active' AND current_period_end IS NOT NULL AND current_period_end < ?", t)
  const expiredPaid = all<{ id: number }>("SELECT id FROM workspaces WHERE subscription_status = 'past_due' AND current_period_end IS NOT NULL AND current_period_end < ?", graceCutoff)

  for (const w of expiredTrials) {
    run("UPDATE workspaces SET subscription_status = 'expired' WHERE id = ?", w.id)
    notify(w.id, { title: 'Your free trial has ended', body: 'Choose a plan to keep sending WhatsApp messages.', link: '/app/billing', type: 'billing' })
  }
  for (const w of pastDue) {
    run("UPDATE workspaces SET subscription_status = 'past_due' WHERE id = ?", w.id)
    notify(w.id, { title: 'Payment due', body: `Your plan period has ended. Renew within ${GRACE_DAYS} days to avoid interruption.`, link: '/app/billing', type: 'billing' })
  }
  for (const w of expiredPaid) {
    run("UPDATE workspaces SET subscription_status = 'expired' WHERE id = ?", w.id)
    notify(w.id, { title: 'Plan expired', body: 'Outgoing messages are paused until you renew.', link: '/app/billing', type: 'billing' })
  }

  // One reminder 3 days before a trial or period ends.
  const soon = new Date(Date.now() + 3 * 86400000).toISOString()
  const ending = all<{ id: number; end: string }>(`SELECT id, COALESCE(CASE WHEN subscription_status = 'trialing' THEN trial_ends_at END, current_period_end) AS end
    FROM workspaces WHERE subscription_status IN ('trialing','active') AND COALESCE(CASE WHEN subscription_status = 'trialing' THEN trial_ends_at END, current_period_end) BETWEEN ? AND ?`, t, soon)
  for (const w of ending) {
    if (get("SELECT id FROM notifications WHERE workspace_id = ? AND type = 'billing_reminder' AND created_at > ?", w.id, new Date(Date.now() - 4 * 86400000).toISOString())) continue
    notify(w.id, { title: 'Your plan ends in 3 days', body: `Renew before ${new Date(w.end).toLocaleDateString('en-IN')} to avoid interruption.`, link: '/app/billing', type: 'billing_reminder' })
  }
}

// ---- Daily database backup (SQLite VACUUM INTO), keeps the last 7 ----
let lastBackupDay = ''
export function backupDatabase(force = false) {
  const day = new Date().toISOString().slice(0, 10)
  if (!force && day === lastBackupDay) return null
  const dir = path.join(config.dataDir, 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `mecgura-${day}.db`)
  if (fs.existsSync(file)) fs.rmSync(file)
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  lastBackupDay = day
  const old = fs.readdirSync(dir).filter((f) => /^mecgura-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse().slice(7)
  for (const f of old) fs.rmSync(path.join(dir, f))
  return file
}
