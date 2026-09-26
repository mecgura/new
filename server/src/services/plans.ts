import { all, get, insert, run, now } from '../db.ts'
import { HttpError } from '../lib/http.ts'
import { period } from '../lib/util.ts'

export type Limits = {
  numbers: number; users: number; contacts: number; messages: number; flows: number; ai_replies: number; campaigns: number
}
export type Feature = 'api' | 'webhooks' | 'catalog' | 'payments' | 'ai' | 'flows' | 'sequences' | 'priority_support'

export type Plan = {
  id: number; code: string; name: string; tagline: string; price_monthly: number; price_yearly: number; currency: string
  limits: Limits; features: Feature[]; is_public: number; sort: number
}

// -1 means unlimited. Prices are in INR (whole rupees). Meta's own WhatsApp conversation charges are billed separately.
const DEFAULT_PLANS: Omit<Plan, 'id'>[] = [
  { code: 'starter', name: 'Starter', tagline: 'For shops & solo businesses starting on WhatsApp', price_monthly: 999, price_yearly: 9990, currency: 'INR',
    limits: { numbers: 1, users: 3, contacts: 2000, messages: 10000, flows: 3, ai_replies: 200, campaigns: 10 },
    features: ['flows', 'sequences'], is_public: 1, sort: 1 },
  { code: 'growth', name: 'Growth', tagline: 'For growing teams running campaigns & automation', price_monthly: 2499, price_yearly: 24990, currency: 'INR',
    limits: { numbers: 2, users: 10, contacts: 25000, messages: 50000, flows: 20, ai_replies: 2000, campaigns: 100 },
    features: ['flows', 'sequences', 'ai', 'api', 'webhooks', 'catalog', 'payments'], is_public: 1, sort: 2 },
  { code: 'pro', name: 'Pro', tagline: 'For high-volume brands & multi-branch businesses', price_monthly: 5999, price_yearly: 59990, currency: 'INR',
    limits: { numbers: 5, users: 25, contacts: 100000, messages: 250000, flows: -1, ai_replies: 10000, campaigns: -1 },
    features: ['flows', 'sequences', 'ai', 'api', 'webhooks', 'catalog', 'payments', 'priority_support'], is_public: 1, sort: 3 },
  { code: 'enterprise', name: 'Enterprise', tagline: 'Custom volumes, onboarding & SLA', price_monthly: 0, price_yearly: 0, currency: 'INR',
    limits: { numbers: -1, users: -1, contacts: -1, messages: -1, flows: -1, ai_replies: -1, campaigns: -1 },
    features: ['flows', 'sequences', 'ai', 'api', 'webhooks', 'catalog', 'payments', 'priority_support'], is_public: 1, sort: 4 },
]

export function seedPlans() {
  for (const p of DEFAULT_PLANS) {
    if (!get('SELECT id FROM plans WHERE code = ?', p.code)) insert('plans', p)
  }
}

export const listPlans = (publicOnly = false) =>
  all<Plan>(`SELECT * FROM plans ${publicOnly ? 'WHERE is_public = 1' : ''} ORDER BY sort`)

export function workspacePlan(workspaceId: number): Plan {
  const p = get<Plan>('SELECT p.* FROM plans p JOIN workspaces w ON w.plan_id = p.id WHERE w.id = ?', workspaceId)
  return p ?? get<Plan>("SELECT * FROM plans WHERE code = 'starter'")!
}

export function getUsage(workspaceId: number, metric: string, p = period()) {
  return Number(get<{ value: number }>('SELECT value FROM usage WHERE workspace_id = ? AND period = ? AND metric = ?', workspaceId, p, metric)?.value ?? 0)
}
export function addUsage(workspaceId: number, metric: string, by = 1) {
  run(`INSERT INTO usage (workspace_id, period, metric, value) VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id, period, metric) DO UPDATE SET value = value + excluded.value`, workspaceId, period(), metric, by)
}

function currentCount(workspaceId: number, limit: keyof Limits): number {
  switch (limit) {
    case 'numbers': return Number(get<{ c: number }>('SELECT COUNT(*) c FROM wa_numbers WHERE workspace_id = ?', workspaceId)!.c)
    case 'users': return Number(get<{ c: number }>('SELECT COUNT(*) c FROM memberships WHERE workspace_id = ?', workspaceId)!.c)
      + Number(get<{ c: number }>('SELECT COUNT(*) c FROM invites WHERE workspace_id = ? AND accepted_at IS NULL', workspaceId)!.c)
    case 'contacts': return Number(get<{ c: number }>('SELECT COUNT(*) c FROM contacts WHERE workspace_id = ?', workspaceId)!.c)
    case 'flows': return Number(get<{ c: number }>('SELECT COUNT(*) c FROM flows WHERE workspace_id = ?', workspaceId)!.c)
    default: return getUsage(workspaceId, limit)
  }
}

export function checkLimit(workspaceId: number, limit: keyof Limits, adding = 1) {
  const plan = workspacePlan(workspaceId)
  const max = plan.limits[limit]
  if (max === undefined || max < 0) return
  if (currentCount(workspaceId, limit) + adding > max) {
    throw new HttpError(402, `Your ${plan.name} plan allows ${max.toLocaleString('en-IN')} ${limit.replace('_', ' ')}. Upgrade your plan to continue.`, 'limit_reached')
  }
}

export function hasFeature(workspaceId: number, f: Feature) {
  return workspacePlan(workspaceId).features.includes(f)
}
export function requireFeature(workspaceId: number, f: Feature) {
  if (!hasFeature(workspaceId, f)) {
    throw new HttpError(402, `This feature is not included in your ${workspacePlan(workspaceId).name} plan. Upgrade to unlock it.`, 'feature_locked')
  }
}

export function usageSummary(workspaceId: number) {
  const plan = workspacePlan(workspaceId)
  const keys = Object.keys(plan.limits) as (keyof Limits)[]
  return { plan, usage: Object.fromEntries(keys.map((k) => [k, { used: currentCount(workspaceId, k), limit: plan.limits[k] }])) }
}

export function activatePlan(workspaceId: number, planId: number, cycle: 'monthly' | 'yearly') {
  const end = new Date()
  if (cycle === 'yearly') end.setFullYear(end.getFullYear() + 1); else end.setMonth(end.getMonth() + 1)
  run("UPDATE workspaces SET plan_id = ?, subscription_status = 'active', current_period_end = ?, status = 'active' WHERE id = ?",
    planId, end.toISOString(), workspaceId)
  run('INSERT INTO audit_logs (workspace_id, action, meta, created_at) VALUES (?, ?, ?, ?)', workspaceId, 'plan.activated',
    JSON.stringify({ planId, cycle }), now())
}
