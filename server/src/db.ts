import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.ts'

fs.mkdirSync(config.dataDir, { recursive: true })
export const db = new DatabaseSync(path.join(config.dataDir, 'mecgura.db'))
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

type Param = string | number | bigint | null | Uint8Array
type Row = Record<string, unknown>

// JSON columns are stored as TEXT and transparently parsed on read.
const JSON_COLS = new Set([
  'limits', 'features', 'settings', 'business', 'tags', 'attributes', 'labels', 'payload', 'components',
  'template_vars', 'audience', 'keywords', 'reply', 'trigger', 'nodes', 'state', 'steps', 'items', 'config',
  'events', 'scopes', 'meta', 'variables',
])

function norm(v: unknown): Param {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v)
  return v as Param
}

export function parseRow<T = Row>(r: Row | undefined): T | undefined {
  if (!r) return undefined
  const out: Row = {}
  for (const [k, v] of Object.entries(r)) {
    if (JSON_COLS.has(k) && typeof v === 'string') {
      try { out[k] = JSON.parse(v) } catch { out[k] = v }
    } else out[k] = v
  }
  return out as T
}

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return (db.prepare(sql).all(...params.map(norm)) as Row[]).map((r) => parseRow<T>(r)!)
}
export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return parseRow<T>(db.prepare(sql).get(...params.map(norm)) as Row | undefined)
}
export function run(sql: string, ...params: unknown[]) {
  return db.prepare(sql).run(...params.map(norm))
}

export function insert(table: string, data: Row): number {
  const keys = Object.keys(data)
  const res = run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => data[k]))
  return Number(res.lastInsertRowid)
}

export function update(table: string, id: number, data: Row, workspaceId?: number) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined)
  if (!keys.length) return
  const where = workspaceId ? 'id = ? AND workspace_id = ?' : 'id = ?'
  const params = [...keys.map((k) => data[k]), id, ...(workspaceId ? [workspaceId] : [])]
  run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${where}`, ...params)
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN')
  try { const r = fn(); db.exec('COMMIT'); return r } catch (e) { db.exec('ROLLBACK'); throw e }
}

export const now = () => new Date().toISOString()

export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, tagline TEXT,
    price_monthly INTEGER NOT NULL DEFAULT 0, price_yearly INTEGER NOT NULL DEFAULT 0, currency TEXT DEFAULT 'INR',
    limits TEXT NOT NULL DEFAULT '{}', features TEXT NOT NULL DEFAULT '[]', is_public INTEGER DEFAULT 1, sort INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE, plan_id INTEGER REFERENCES plans(id),
    status TEXT DEFAULT 'active', subscription_status TEXT DEFAULT 'trialing', trial_ends_at TEXT, current_period_end TEXT,
    business TEXT DEFAULT '{}', settings TEXT DEFAULT '{}', timezone TEXT DEFAULT 'Asia/Kolkata', rr_cursor INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT, password_hash TEXT NOT NULL,
    is_super_admin INTEGER DEFAULT 0, last_login_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memberships (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'agent',
    is_online INTEGER DEFAULT 1, created_at TEXT NOT NULL, UNIQUE(workspace_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, email TEXT NOT NULL,
    role TEXT NOT NULL, token TEXT UNIQUE NOT NULL, invited_by INTEGER, expires_at TEXT, accepted_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS wa_numbers (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, label TEXT,
    phone_number_id TEXT UNIQUE NOT NULL, waba_id TEXT, display_phone TEXT, verified_name TEXT, access_token TEXT,
    quality_rating TEXT, messaging_limit TEXT, status TEXT DEFAULT 'connected', is_default INTEGER DEFAULT 0, is_demo INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, wa_id TEXT NOT NULL,
    name TEXT, email TEXT, tags TEXT DEFAULT '[]', attributes TEXT DEFAULT '{}', stage TEXT DEFAULT 'new', deal_value INTEGER DEFAULT 0,
    lead_score INTEGER DEFAULT 0, owner_id INTEGER, source TEXT DEFAULT 'whatsapp', opted_out INTEGER DEFAULT 0,
    last_seen_at TEXT, created_at TEXT NOT NULL, UNIQUE(workspace_id, wa_id)
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, number_id INTEGER REFERENCES wa_numbers(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'open', assigned_to INTEGER, unread_count INTEGER DEFAULT 0, bot_paused INTEGER DEFAULT 0,
    last_message_at TEXT, last_inbound_at TEXT, last_preview TEXT, first_response_at TEXT, created_at TEXT NOT NULL,
    UNIQUE(workspace_id, contact_id, number_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL, number_id INTEGER, direction TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'text', body TEXT,
    payload TEXT DEFAULT '{}', wa_message_id TEXT, status TEXT DEFAULT 'queued', error TEXT, sent_by TEXT, user_id INTEGER,
    campaign_id INTEGER, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, id);
  CREATE INDEX IF NOT EXISTS idx_msg_wamid ON messages(wa_message_id);
  CREATE INDEX IF NOT EXISTS idx_msg_ws_date ON messages(workspace_id, created_at);
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    user_id INTEGER, body TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS quick_replies (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, shortcut TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, number_id INTEGER,
    name TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'en', category TEXT NOT NULL DEFAULT 'MARKETING', status TEXT DEFAULT 'DRAFT',
    components TEXT NOT NULL DEFAULT '[]', wa_template_id TEXT, rejection_reason TEXT, updated_at TEXT, created_at TEXT NOT NULL,
    UNIQUE(workspace_id, name, language)
  );
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, number_id INTEGER,
    name TEXT NOT NULL, template_id INTEGER, template_vars TEXT DEFAULT '{}', audience TEXT DEFAULT '{}', status TEXT DEFAULT 'draft',
    scheduled_at TEXT, started_at TEXT, completed_at TEXT, total INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, delivered INTEGER DEFAULT 0,
    read INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, replied INTEGER DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS campaign_recipients (
    id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, contact_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending', message_id INTEGER, error TEXT, sent_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cr ON campaign_recipients(campaign_id, status);
  CREATE TABLE IF NOT EXISTS bot_rules (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL,
    match_type TEXT DEFAULT 'contains', keywords TEXT DEFAULT '[]', reply TEXT NOT NULL DEFAULT '{}', priority INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1, hits INTEGER DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS flows (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL,
    description TEXT, trigger TEXT NOT NULL DEFAULT '{}', nodes TEXT NOT NULL DEFAULT '[]', is_active INTEGER DEFAULT 0,
    runs INTEGER DEFAULT 0, completions INTEGER DEFAULT 0, updated_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS flow_runs (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, flow_id INTEGER NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL, conversation_id INTEGER, current_node TEXT, state TEXT DEFAULT '{}', status TEXT DEFAULT 'running',
    wait_until TEXT, created_at TEXT NOT NULL, updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_fr ON flow_runs(workspace_id, contact_id, status);
  CREATE TABLE IF NOT EXISTS sequences (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL,
    trigger TEXT DEFAULT '{}', steps TEXT DEFAULT '[]', is_active INTEGER DEFAULT 1, stop_on_reply INTEGER DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sequence_enrollments (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, sequence_id INTEGER NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL, step_index INTEGER DEFAULT 0, next_run_at TEXT, status TEXT DEFAULT 'active', created_at TEXT NOT NULL,
    UNIQUE(sequence_id, contact_id)
  );
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL,
    description TEXT, price INTEGER NOT NULL DEFAULT 0, currency TEXT DEFAULT 'INR', image_url TEXT, retailer_id TEXT, category TEXT,
    stock INTEGER, is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, contact_id INTEGER,
    items TEXT DEFAULT '[]', total INTEGER DEFAULT 0, currency TEXT DEFAULT 'INR', status TEXT DEFAULT 'pending',
    payment_status TEXT DEFAULT 'unpaid', payment_id INTEGER, source TEXT DEFAULT 'manual', notes TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, contact_id INTEGER,
    order_id INTEGER, amount INTEGER NOT NULL, currency TEXT DEFAULT 'INR', description TEXT, provider TEXT DEFAULT 'razorpay',
    provider_ref TEXT, short_url TEXT, status TEXT DEFAULT 'created', paid_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, provider TEXT NOT NULL,
    config TEXT DEFAULT '{}', enabled INTEGER DEFAULT 1, created_at TEXT NOT NULL, UNIQUE(workspace_id, provider)
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL,
    prefix TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL, scopes TEXT DEFAULT '["*"]', last_used_at TEXT, created_by INTEGER,
    revoked_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, url TEXT NOT NULL,
    events TEXT DEFAULT '["*"]', secret TEXT NOT NULL, is_active INTEGER DEFAULT 1, failure_count INTEGER DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event TEXT NOT NULL, payload TEXT, status TEXT DEFAULT 'pending', status_code INTEGER, response TEXT, attempts INTEGER DEFAULT 0,
    next_attempt_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage (
    workspace_id INTEGER NOT NULL, period TEXT NOT NULL, metric TEXT NOT NULL, value INTEGER DEFAULT 0,
    PRIMARY KEY (workspace_id, period, metric)
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, plan_id INTEGER,
    amount INTEGER NOT NULL, currency TEXT DEFAULT 'INR', cycle TEXT DEFAULT 'monthly', status TEXT DEFAULT 'created',
    provider_order_id TEXT, provider_payment_id TEXT, period_end TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL, user_id INTEGER, type TEXT, title TEXT NOT NULL, body TEXT, link TEXT,
    read_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY, workspace_id INTEGER, user_id INTEGER, action TEXT NOT NULL, meta TEXT DEFAULT '{}', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS site_leads (
    id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT, company TEXT, message TEXT, status TEXT DEFAULT 'new', created_at TEXT NOT NULL
  );
  `)
}
