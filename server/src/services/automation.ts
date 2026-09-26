import { all, get, insert, run, update, now } from '../db.ts'
import { renderVars, addMinutes } from '../lib/util.ts'
import { publish } from '../lib/events.ts'
import type { OutMessage } from './whatsapp.ts'
import { sendToContact, contactContext, roundRobinAgent, notify, type Contact, type Conversation } from './messaging.ts'
import { aiReply, type AiSettings } from './ai.ts'
import { emitEvent } from './hooks.ts'
import { hasFeature } from './plans.ts'

// ---------- Shared reply format used by bot rules and flow "message" nodes ----------
export type Reply =
  | { type: 'text'; text: string }
  | { type: 'media'; media_type: 'image' | 'video' | 'document'; link: string; caption?: string }
  | { type: 'buttons'; text: string; buttons: string[]; footer?: string }
  | { type: 'list'; text: string; button: string; items: string[] }
  | { type: 'cta_url'; text: string; display_text: string; url: string }
  | { type: 'template'; name: string; language: string; components?: unknown[] }

export function replyToMessage(r: Reply, ctx: Record<string, unknown>, idPrefix = 'opt'): OutMessage {
  const t = (s: string) => renderVars(s, ctx)
  switch (r.type) {
    case 'text': return { type: 'text', text: t(r.text) }
    case 'media': return { type: r.media_type, link: r.link, caption: r.caption ? t(r.caption) : undefined }
    case 'buttons': return { type: 'buttons', text: t(r.text), footer: r.footer, buttons: r.buttons.filter(Boolean).slice(0, 3).map((b, i) => ({ id: `${idPrefix}:${i}`, title: b })) }
    case 'list': return { type: 'list', text: t(r.text), button: r.button || 'Choose', sections: [{ title: 'Options', rows: r.items.filter(Boolean).slice(0, 10).map((b, i) => ({ id: `${idPrefix}:${i}`, title: b })) }] }
    case 'cta_url': return { type: 'cta_url', text: t(r.text), display_text: r.display_text, url: t(r.url) }
    case 'template': return { type: 'template', name: r.name, language: r.language, components: r.components }
  }
}

export type Inbound = { text: string; buttonId?: string; type: string }

// ---------- Flow engine ----------
export type FlowNode = {
  id: string
  type: 'message' | 'question' | 'buttons' | 'condition' | 'action' | 'delay' | 'webhook' | 'ai' | 'handoff' | 'end'
  data: Record<string, unknown>
  next?: string | null
  branches?: Record<string, string | null>
}
type Flow = { id: number; workspace_id: number; name: string; trigger: { type: string; value?: string; match?: string }; nodes: FlowNode[]; is_active: number }
type Run = { id: number; workspace_id: number; flow_id: number; contact_id: number; conversation_id: number | null; current_node: string | null; state: Record<string, unknown>; status: string }

const MAX_STEPS = 40

async function execFlow(runId: number, input?: Inbound) {
  let r = get<Run>('SELECT * FROM flow_runs WHERE id = ?', runId)
  if (!r) return
  const flow = get<Flow>('SELECT * FROM flows WHERE id = ?', r.flow_id)
  if (!flow) return
  const nodes = new Map(flow.nodes.map((n) => [n.id, n]))
  let steps = 0
  let pendingInput = input

  while (r.current_node && steps++ < MAX_STEPS) {
    const node = nodes.get(r.current_node)
    if (!node) break
    const contact = get<Contact>('SELECT * FROM contacts WHERE id = ?', r.contact_id)!
    const ctx = { ...contactContext(contact), vars: r.state, ...r.state }
    const send = (m: OutMessage) => sendToContact({ workspaceId: r!.workspace_id, contactId: contact.id, message: m, sentBy: 'flow', numberId: numberOf(r!) })
    let next: string | null | undefined = node.next ?? null

    if (node.type === 'message') {
      await send(replyToMessage(node.data.reply as Reply, ctx, `flow:${node.id}`))
    } else if (node.type === 'question' || node.type === 'buttons') {
      if (!pendingInput) {
        if (node.type === 'question') await send({ type: 'text', text: renderVars(String(node.data.text || ''), ctx) })
        else await send(replyToMessage({ type: 'buttons', text: String(node.data.text || ''), buttons: (node.data.options as string[]) ?? [] }, ctx, `flow:${node.id}`))
        update('flow_runs', r.id, { status: 'waiting', updated_at: now() })
        return
      }
      const answer = pendingInput.text.trim()
      pendingInput = undefined
      if (node.type === 'question') {
        const v = String(node.data.validate || 'any')
        const ok = v === 'email' ? /^\S+@\S+\.\S+$/.test(answer) : v === 'number' ? /^-?\d+(\.\d+)?$/.test(answer) : v === 'phone' ? /^\+?\d{8,15}$/.test(answer.replace(/[\s-]/g, '')) : !!answer
        if (!ok) {
          await send({ type: 'text', text: String(node.data.retry_text || 'Sorry, that does not look right. Please try again.') })
          update('flow_runs', r.id, { status: 'waiting', updated_at: now() })
          return
        }
        const key = String(node.data.save_as || '')
        if (key) saveField(contact, key, answer, r)
      } else {
        const opts = ((node.data.options as string[]) ?? []).map((o) => o.toLowerCase())
        const idx = input?.buttonId?.startsWith(`flow:${node.id}:`) ? Number(input.buttonId.split(':').pop()) : opts.indexOf(answer.toLowerCase())
        const key = String(node.data.save_as || '')
        if (key && idx >= 0) saveField(contact, key, (node.data.options as string[])[idx], r)
        next = idx >= 0 ? (node.branches?.[String(idx)] ?? node.next) : (node.branches?.other ?? node.next)
      }
    } else if (node.type === 'condition') {
      next = evalCondition(node.data, contact, r.state) ? node.branches?.yes : node.branches?.no
    } else if (node.type === 'action') {
      await runAction(node.data, contact, r)
    } else if (node.type === 'delay') {
      const mins = Math.max(1, Number(node.data.minutes) || 1)
      update('flow_runs', r.id, { status: 'sleeping', wait_until: addMinutes(mins), current_node: next, updated_at: now() })
      return
    } else if (node.type === 'webhook') {
      try {
        const res = await fetch(String(node.data.url), { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact, variables: r.state, flow: { id: flow.id, name: flow.name } }) })
        const json = await res.json().catch(() => ({}))
        if (node.data.save_as) r.state[String(node.data.save_as)] = json
        next = res.ok ? node.next : (node.branches?.error ?? node.next)
      } catch { next = node.branches?.error ?? node.next }
    } else if (node.type === 'ai') {
      if (r.conversation_id) {
        const out = await aiReply(r.workspace_id, r.conversation_id).catch(() => ({ handoff: true }))
        if ('text' in out && out.text) await send({ type: 'text', text: out.text })
        else await handoff(r.workspace_id, r.conversation_id, 'AI handed over from a flow')
      }
    } else if (node.type === 'handoff') {
      if (node.data.text) await send({ type: 'text', text: renderVars(String(node.data.text), ctx) })
      if (r.conversation_id) await handoff(r.workspace_id, r.conversation_id, `Flow "${flow.name}" requested a human`)
      next = null
    } else if (node.type === 'end') next = null

    r = { ...r, current_node: next ?? null }
    update('flow_runs', r.id, { current_node: r.current_node, state: r.state, status: 'running', updated_at: now() })
  }
  update('flow_runs', r.id, { status: 'completed', current_node: null, updated_at: now() })
  run('UPDATE flows SET completions = completions + 1 WHERE id = ?', r.flow_id)
  emitEvent(r.workspace_id, 'flow.completed', { flow_id: r.flow_id, contact_id: r.contact_id, variables: r.state })
}

function numberOf(r: Run) {
  return r.conversation_id ? get<{ number_id: number }>('SELECT number_id FROM conversations WHERE id = ?', r.conversation_id)?.number_id : undefined
}

function saveField(contact: Contact, key: string, value: unknown, r: Run) {
  r.state[key] = value
  if (key === 'name' || key === 'email') update('contacts', contact.id, { [key]: String(value) })
  else update('contacts', contact.id, { attributes: { ...contact.attributes, [key]: value } })
}

function evalCondition(d: Record<string, unknown>, c: Contact, state: Record<string, unknown>) {
  const field = String(d.field || '')
  const op = String(d.op || 'equals')
  const val = String(d.value ?? '').toLowerCase()
  if (op === 'has_tag') return c.tags.map((t) => t.toLowerCase()).includes(val)
  if (op === 'not_has_tag') return !c.tags.map((t) => t.toLowerCase()).includes(val)
  const raw = field === 'stage' ? c.stage : field === 'name' ? c.name : field === 'email' ? c.email : (state[field] ?? c.attributes[field])
  const actual = raw === undefined || raw === null ? '' : String(raw).toLowerCase()
  switch (op) {
    case 'equals': return actual === val
    case 'not_equals': return actual !== val
    case 'contains': return actual.includes(val)
    case 'exists': return actual !== ''
    case 'gt': return Number(actual) > Number(val)
    case 'lt': return Number(actual) < Number(val)
    default: return false
  }
}

async function runAction(d: Record<string, unknown>, c: Contact, r: Run) {
  const kind = String(d.action)
  const value = String(d.value ?? '')
  if (kind === 'add_tag') { update('contacts', c.id, { tags: [...new Set([...c.tags, value])] }); await onTagAdded(r.workspace_id, c.id, value) }
  else if (kind === 'remove_tag') update('contacts', c.id, { tags: c.tags.filter((t) => t !== value) })
  else if (kind === 'set_stage') update('contacts', c.id, { stage: value })
  else if (kind === 'set_attribute') update('contacts', c.id, { attributes: { ...c.attributes, [String(d.key)]: renderVars(value, { ...contactContext(c), ...r.state }) } })
  else if (kind === 'assign' && r.conversation_id) {
    const to = value === 'round_robin' ? roundRobinAgent(r.workspace_id) : Number(value) || null
    update('conversations', r.conversation_id, { assigned_to: to })
    publish(r.workspace_id, 'conversation', { id: r.conversation_id })
  } else if (kind === 'resolve' && r.conversation_id) update('conversations', r.conversation_id, { status: 'resolved' })
  else if (kind === 'subscribe_sequence') enrollInSequence(r.workspace_id, Number(value), c.id)
  else if (kind === 'opt_out') update('contacts', c.id, { opted_out: 1 })
  else if (kind === 'notify') notify(r.workspace_id, { title: renderVars(value || 'Flow notification', { ...contactContext(c), ...r.state }), body: c.name || c.wa_id, type: 'flow' })
}

async function handoff(workspaceId: number, conversationId: number, reason: string) {
  const conv = get<Conversation>('SELECT * FROM conversations WHERE id = ?', conversationId)!
  const agent = conv.assigned_to ?? roundRobinAgent(workspaceId)
  update('conversations', conversationId, { bot_paused: 1, status: 'open', assigned_to: agent })
  notify(workspaceId, { title: 'Chat needs a human', body: reason, link: `/app/inbox?c=${conversationId}`, userId: agent, type: 'handoff' })
  publish(workspaceId, 'conversation', { id: conversationId })
}

export async function startFlow(flowId: number, contactId: number, conversationId: number | null, input?: Inbound) {
  const flow = get<Flow>('SELECT * FROM flows WHERE id = ?', flowId)
  if (!flow || !flow.nodes.length) return
  run("UPDATE flow_runs SET status = 'cancelled' WHERE contact_id = ? AND workspace_id = ? AND status IN ('waiting','running','sleeping')", contactId, flow.workspace_id)
  const start = flow.nodes[0].id
  const rid = insert('flow_runs', { workspace_id: flow.workspace_id, flow_id: flow.id, contact_id: contactId, conversation_id: conversationId,
    current_node: start, state: { trigger_text: input?.text ?? '' }, status: 'running', created_at: now(), updated_at: now() })
  run('UPDATE flows SET runs = runs + 1 WHERE id = ?', flow.id)
  await execFlow(rid)
}

export async function resumeSleepingRuns() {
  const due = all<{ id: number }>("SELECT id FROM flow_runs WHERE status = 'sleeping' AND wait_until <= ? LIMIT 50", now())
  for (const d of due) { update('flow_runs', d.id, { status: 'running' }); await execFlow(d.id).catch((e) => console.error('flow', e)) }
}

// ---------- Sequences (drip follow-ups) ----------
type SeqStep = { delay_minutes: number; reply: Reply }
export function enrollInSequence(workspaceId: number, sequenceId: number, contactId: number) {
  const seq = get<{ id: number; steps: SeqStep[]; is_active: number }>('SELECT id, steps, is_active FROM sequences WHERE id = ? AND workspace_id = ?', sequenceId, workspaceId)
  if (!seq || !seq.is_active || !seq.steps.length) return false
  run(`INSERT INTO sequence_enrollments (workspace_id, sequence_id, contact_id, step_index, next_run_at, status, created_at)
       VALUES (?, ?, ?, 0, ?, 'active', ?) ON CONFLICT(sequence_id, contact_id) DO UPDATE SET step_index = 0, next_run_at = excluded.next_run_at, status = 'active'`,
  workspaceId, seq.id, contactId, addMinutes(seq.steps[0].delay_minutes || 0), now())
  return true
}

export async function processSequences() {
  const due = all<{ id: number; workspace_id: number; sequence_id: number; contact_id: number; step_index: number }>(
    "SELECT * FROM sequence_enrollments WHERE status = 'active' AND next_run_at <= ? LIMIT 50", now())
  for (const e of due) {
    const seq = get<{ steps: SeqStep[]; is_active: number }>('SELECT steps, is_active FROM sequences WHERE id = ?', e.sequence_id)
    const step = seq?.steps[e.step_index]
    if (!seq || !seq.is_active || !step) { update('sequence_enrollments', e.id, { status: 'completed' }); continue }
    const contact = get<Contact>('SELECT * FROM contacts WHERE id = ?', e.contact_id)
    if (!contact || contact.opted_out) { update('sequence_enrollments', e.id, { status: 'stopped' }); continue }
    try {
      await sendToContact({ workspaceId: e.workspace_id, contactId: contact.id, message: replyToMessage(step.reply, contactContext(contact)), sentBy: 'sequence', marketing: true })
    } catch (err) { console.warn('sequence step failed', (err as Error).message) }
    const nextStep = seq.steps[e.step_index + 1]
    update('sequence_enrollments', e.id, nextStep
      ? { step_index: e.step_index + 1, next_run_at: addMinutes(nextStep.delay_minutes || 0) }
      : { status: 'completed', step_index: e.step_index + 1 })
  }
}

export async function onTagAdded(workspaceId: number, contactId: number, tag: string) {
  const seqs = all<{ id: number; trigger: { type: string; value?: string } }>('SELECT id, trigger FROM sequences WHERE workspace_id = ? AND is_active = 1', workspaceId)
  for (const s of seqs) if (s.trigger?.type === 'tag_added' && s.trigger.value?.toLowerCase() === tag.toLowerCase()) enrollInSequence(workspaceId, s.id, contactId)
  const flows = all<Flow>("SELECT * FROM flows WHERE workspace_id = ? AND is_active = 1", workspaceId)
  for (const f of flows) if (f.trigger?.type === 'tag_added' && f.trigger.value?.toLowerCase() === tag.toLowerCase()) {
    const conv = get<{ id: number }>('SELECT id FROM conversations WHERE contact_id = ? ORDER BY last_message_at DESC LIMIT 1', contactId)
    await startFlow(f.id, contactId, conv?.id ?? null)
  }
}

// ---------- Inbound automation pipeline ----------
type Settings = {
  welcome?: { enabled?: boolean; text?: string }
  away?: { enabled?: boolean; text?: string }
  hours?: { enabled?: boolean; days?: number[]; start?: string; end?: string }
  ai?: AiSettings
  opt_out_keywords?: string[]
}

function withinHours(s: Settings, tz: string) {
  if (!s.hours?.enabled) return true
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date())
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')!.value)
  const hm = `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`
  const days = s.hours.days ?? [1, 2, 3, 4, 5, 6]
  return days.includes(wd) && hm >= (s.hours.start || '09:00') && hm < (s.hours.end || '19:00')
}

function matches(matchType: string, keywords: string[], text: string) {
  const t = text.trim().toLowerCase()
  if (matchType === 'any') return true
  return keywords.some((kRaw) => {
    const k = kRaw.trim().toLowerCase()
    if (!k) return false
    if (matchType === 'exact') return t === k
    if (matchType === 'starts') return t.startsWith(k)
    if (matchType === 'regex') { try { return new RegExp(kRaw, 'i').test(text) } catch { return false } }
    return t.includes(k)
  })
}

export async function handleInbound(workspaceId: number, contact: Contact, conv: Conversation, input: Inbound, isNewContact: boolean) {
  const ws = get<{ settings: Settings; timezone: string }>('SELECT settings, timezone FROM workspaces WHERE id = ?', workspaceId)!
  const s = ws.settings ?? {}
  const text = input.text.trim()
  const lower = text.toLowerCase()
  const send = (m: OutMessage, by: 'bot' | 'ai' = 'bot') => sendToContact({ workspaceId, contactId: contact.id, numberId: conv.number_id, message: m, sentBy: by })

  // 1. Opt-out / opt-in compliance keywords.
  const optOut = s.opt_out_keywords ?? ['stop', 'unsubscribe']
  if (optOut.includes(lower)) {
    update('contacts', contact.id, { opted_out: 1 })
    run("UPDATE sequence_enrollments SET status = 'stopped' WHERE contact_id = ? AND status = 'active'", contact.id)
    await send({ type: 'text', text: 'You have been unsubscribed from promotional messages. Reply START to subscribe again.' })
    return
  }
  if (lower === 'start' && contact.opted_out) {
    update('contacts', contact.id, { opted_out: 0 })
    await send({ type: 'text', text: 'Welcome back! You are subscribed again. 🙌' })
    return
  }

  // Replies stop "stop on reply" sequences.
  run(`UPDATE sequence_enrollments SET status = 'replied' WHERE contact_id = ? AND status = 'active'
       AND sequence_id IN (SELECT id FROM sequences WHERE stop_on_reply = 1)`, contact.id)

  // Mark latest campaign as replied (once per recipient).
  const lastCampaignMsg = get<{ campaign_id: number; id: number }>(
    "SELECT campaign_id, id FROM messages WHERE contact_id = ? AND campaign_id IS NOT NULL AND direction = 'out' AND created_at > ? ORDER BY id DESC LIMIT 1",
    contact.id, new Date(Date.now() - 3 * 86400000).toISOString())
  if (lastCampaignMsg) {
    const r = run("UPDATE campaign_recipients SET status = 'replied' WHERE campaign_id = ? AND contact_id = ? AND status != 'replied'", lastCampaignMsg.campaign_id, contact.id)
    if (Number(r.changes)) run('UPDATE campaigns SET replied = replied + 1 WHERE id = ?', lastCampaignMsg.campaign_id)
  }

  if (conv.bot_paused) return

  // 2. Continue a flow that is waiting for this contact's answer.
  const waiting = get<{ id: number }>("SELECT id FROM flow_runs WHERE contact_id = ? AND workspace_id = ? AND status = 'waiting' ORDER BY id DESC LIMIT 1", contact.id, workspaceId)
  if (waiting) { update('flow_runs', waiting.id, { status: 'running', conversation_id: conv.id }); await execFlow(waiting.id, input); return }

  // 3. Flow triggers.
  if (hasFeature(workspaceId, 'flows')) {
    const flows = all<Flow>('SELECT * FROM flows WHERE workspace_id = ? AND is_active = 1 ORDER BY id', workspaceId)
    const hit = flows.find((f) => f.trigger?.type === 'keyword' && matches(f.trigger.match || 'exact', String(f.trigger.value || '').split(','), text))
      ?? (isNewContact ? flows.find((f) => f.trigger?.type === 'new_contact') : undefined)
      ?? flows.find((f) => f.trigger?.type === 'any_message')
    if (hit) { await startFlow(hit.id, contact.id, conv.id, input); return }
  }

  // 4. Keyword chatbot rules.
  const rules = all<{ id: number; match_type: string; keywords: string[]; reply: Reply & { flow_id?: number } }>(
    'SELECT * FROM bot_rules WHERE workspace_id = ? AND is_active = 1 ORDER BY priority DESC, id', workspaceId)
  const rule = rules.find((r) => matches(r.match_type, r.keywords, text))
  if (rule) {
    run('UPDATE bot_rules SET hits = hits + 1 WHERE id = ?', rule.id)
    await send(replyToMessage(rule.reply, contactContext(contact), `rule:${rule.id}`))
    return
  }

  // 5. Welcome / away messages.
  const inHours = withinHours(s, ws.timezone || 'Asia/Kolkata')
  if (!inHours && s.away?.enabled && s.away.text) {
    const recent = get("SELECT id FROM messages WHERE conversation_id = ? AND sent_by = 'bot' AND body = ? AND created_at > ?", conv.id, renderVars(s.away.text, contactContext(contact)), new Date(Date.now() - 6 * 3600000).toISOString())
    if (!recent) await send({ type: 'text', text: renderVars(s.away.text, contactContext(contact)) })
  } else if (isNewContact && s.welcome?.enabled && s.welcome.text) {
    await send({ type: 'text', text: renderVars(s.welcome.text, contactContext(contact)) })
    return
  }

  // 6. AI auto-reply.
  const ai = s.ai ?? {}
  if (ai.enabled && ai.mode === 'auto' && hasFeature(workspaceId, 'ai')) {
    if ((ai.handoff_keywords ?? []).some((k) => k && lower.includes(k.toLowerCase()))) { await handoff(workspaceId, conv.id, `Customer asked: "${text.slice(0, 80)}"`); return }
    const count = Number(get<{ c: number }>("SELECT COUNT(*) c FROM messages WHERE conversation_id = ? AND sent_by = 'ai' AND created_at > ?", conv.id, new Date(Date.now() - 86400000).toISOString())!.c)
    if (count >= (ai.max_replies_per_chat || 15)) { await handoff(workspaceId, conv.id, 'AI reply limit for this chat reached'); return }
    try {
      const out = await aiReply(workspaceId, conv.id)
      if (out.text) await send({ type: 'text', text: out.text }, 'ai')
      else if (out.handoff) await handoff(workspaceId, conv.id, 'AI could not answer confidently')
    } catch (e) { console.warn('AI reply failed:', (e as Error).message) }
  }
}
