import { Router } from 'express'
import { all, get } from '../db.ts'
import { h } from '../lib/http.ts'
import { perm } from '../lib/auth.ts'

export const analyticsRoutes = Router()

analyticsRoutes.get('/analytics', perm('analytics.view'), h((req, res) => {
  const w = req.ws!.id
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180)
  const since = new Date(Date.now() - (days - 1) * 86400000); since.setHours(0, 0, 0, 0)
  const s = since.toISOString()
  const n = (sql: string, ...p: unknown[]) => Number(get<{ c: number }>(sql, ...p)?.c ?? 0)

  const byDay = all<{ d: string; dir: string; c: number }>('SELECT substr(created_at,1,10) d, direction dir, COUNT(*) c FROM messages WHERE workspace_id = ? AND created_at >= ? GROUP BY d, dir', w, s)
  const contactsByDay = all<{ d: string; c: number }>('SELECT substr(created_at,1,10) d, COUNT(*) c FROM contacts WHERE workspace_id = ? AND created_at >= ? GROUP BY d', w, s)
  const series = [...Array(days)].map((_, i) => {
    const d = new Date(since.getTime() + i * 86400000).toISOString().slice(0, 10)
    return { date: d, inbound: byDay.find((x) => x.d === d && x.dir === 'in')?.c ?? 0, outbound: byDay.find((x) => x.d === d && x.dir === 'out')?.c ?? 0, contacts: contactsByDay.find((x) => x.d === d)?.c ?? 0 }
  })
  const statuses = all<{ status: string; c: number }>("SELECT status, COUNT(*) c FROM messages WHERE workspace_id = ? AND direction = 'out' AND created_at >= ? GROUP BY status", w, s)
  const bySender = all<{ sent_by: string; c: number }>("SELECT sent_by, COUNT(*) c FROM messages WHERE workspace_id = ? AND direction = 'out' AND created_at >= ? GROUP BY sent_by", w, s)
  const agents = all(`SELECT u.id, u.name,
      (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id AND m.workspace_id = ? AND m.created_at >= ?) AS messages,
      (SELECT COUNT(*) FROM conversations c WHERE c.assigned_to = u.id AND c.workspace_id = ? AND c.status = 'resolved' AND c.last_message_at >= ?) AS resolved,
      (SELECT COUNT(*) FROM conversations c WHERE c.assigned_to = u.id AND c.workspace_id = ? AND c.status = 'open') AS open,
      (SELECT AVG((julianday(c.first_response_at) - julianday(c.created_at)) * 1440) FROM conversations c WHERE c.assigned_to = u.id AND c.workspace_id = ? AND c.first_response_at IS NOT NULL AND c.created_at >= ?) AS avg_first_response_min
    FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?`, w, s, w, s, w, w, s, w)
  const campaigns = all('SELECT id, name, total, sent, delivered, read, failed, replied, created_at FROM campaigns WHERE workspace_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 20', w, s)
  const flows = all('SELECT id, name, runs, completions FROM flows WHERE workspace_id = ? ORDER BY runs DESC LIMIT 10', w)
  const botRules = all('SELECT id, name, hits FROM bot_rules WHERE workspace_id = ? ORDER BY hits DESC LIMIT 10', w)
  const tags = all('SELECT j.value AS tag, COUNT(*) c FROM contacts c, json_each(c.tags) j WHERE c.workspace_id = ? GROUP BY j.value ORDER BY c DESC LIMIT 10', w)
  const busyHours = all<{ h: string; c: number }>("SELECT substr(created_at,12,2) h, COUNT(*) c FROM messages WHERE workspace_id = ? AND direction = 'in' AND created_at >= ? GROUP BY h", w, s)

  res.json({
    days, series, statuses, by_sender: bySender, agents, campaigns, flows, bot_rules: botRules, tags,
    busy_hours: [...Array(24)].map((_, i) => ({ hour: i, count: busyHours.find((b) => Number(b.h) === i)?.c ?? 0 })),
    totals: {
      inbound: n("SELECT COUNT(*) c FROM messages WHERE workspace_id = ? AND direction = 'in' AND created_at >= ?", w, s),
      outbound: n("SELECT COUNT(*) c FROM messages WHERE workspace_id = ? AND direction = 'out' AND created_at >= ?", w, s),
      new_contacts: n('SELECT COUNT(*) c FROM contacts WHERE workspace_id = ? AND created_at >= ?', w, s),
      conversations: n('SELECT COUNT(*) c FROM conversations WHERE workspace_id = ? AND created_at >= ?', w, s),
      resolved: n("SELECT COUNT(*) c FROM conversations WHERE workspace_id = ? AND status = 'resolved' AND last_message_at >= ?", w, s),
      automated: n("SELECT COUNT(*) c FROM messages WHERE workspace_id = ? AND direction = 'out' AND sent_by IN ('bot','flow','ai','sequence') AND created_at >= ?", w, s),
      revenue: n("SELECT COALESCE(SUM(amount),0) c FROM payments WHERE workspace_id = ? AND status = 'paid' AND paid_at >= ?", w, s),
      orders: n('SELECT COUNT(*) c FROM orders WHERE workspace_id = ? AND created_at >= ?', w, s),
      avg_first_response_min: Number(get<{ v: number }>('SELECT AVG((julianday(first_response_at) - julianday(created_at)) * 1440) v FROM conversations WHERE workspace_id = ? AND first_response_at IS NOT NULL AND created_at >= ?', w, s)?.v ?? 0),
    },
  })
}))
