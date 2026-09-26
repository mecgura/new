import Anthropic from '@anthropic-ai/sdk'
import { all, get } from '../db.ts'
import { config } from '../config.ts'
import { decrypt } from '../lib/security.ts'
import { bad } from '../lib/http.ts'
import { checkLimit } from './plans.ts'

export type AiSettings = {
  enabled?: boolean; mode?: 'off' | 'suggest' | 'auto'; persona?: string; knowledge?: string
  handoff_keywords?: string[]; language?: string; max_replies_per_chat?: number
}

const HANDOFF = '[HANDOFF]'

function clientFor(workspaceId: number) {
  const integ = get<{ config: { api_key?: string } }>("SELECT config FROM integrations WHERE workspace_id = ? AND provider = 'anthropic' AND enabled = 1", workspaceId)
  const apiKey = decrypt(integ?.config?.api_key) || config.anthropic.apiKey
  if (!apiKey) throw bad('AI is not configured. Add an Anthropic API key in Integrations or ask MECGURA support to enable it.', 'ai_not_configured')
  return new Anthropic({ apiKey })
}

async function complete(workspaceId: number, system: string, messages: Anthropic.MessageParam[], maxTokens = 1024) {
  const client = clientFor(workspaceId)
  // Server-side fallback keeps replies flowing if the primary model declines a request.
  const params = {
    model: config.anthropic.model, max_tokens: maxTokens, system, messages,
    output_config: { effort: 'low' as const },
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
  }
  const res = await client.beta.messages.create(params as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming)
  if (res.stop_reason === 'refusal') return ''
  return res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('').trim()
}

function businessContext(workspaceId: number) {
  const ws = get<{ name: string; business: Record<string, string>; settings: { ai?: AiSettings } }>('SELECT name, business, settings FROM workspaces WHERE id = ?', workspaceId)!
  const ai = ws.settings?.ai ?? {}
  const products = all<{ name: string; price: number; currency: string; description: string | null }>(
    'SELECT name, price, currency, description FROM products WHERE workspace_id = ? AND is_active = 1 LIMIT 40', workspaceId)
  const productText = products.length
    ? '\n\nProducts / services:\n' + products.map((p) => `- ${p.name}: ${p.currency} ${p.price}${p.description ? ` — ${p.description}` : ''}`).join('\n') : ''
  return { ws, ai, text:
`You are the WhatsApp assistant for "${ws.name}".
${ai.persona ? `Persona and tone: ${ai.persona}\n` : ''}Business details: ${JSON.stringify(ws.business ?? {})}
Knowledge base (the only source of truth for facts, prices, policies):
${ai.knowledge || '(none provided)'}${productText}

Rules:
- Reply like a helpful human on WhatsApp: short (max ~80 words), friendly, no markdown headings, at most one emoji.
- Reply in the customer's language (${ai.language || 'match the customer, e.g. English, Hindi, Punjabi or Hinglish'}).
- Never invent prices, stock, timings, policies or links that are not in the knowledge base.
- If you cannot answer confidently, the customer asks for a human, or the topic is a complaint/refund/legal matter, reply with exactly ${HANDOFF}.` }
}

function transcript(conversationId: number): Anthropic.MessageParam[] {
  const rows = all<{ direction: string; body: string | null }>(
    'SELECT direction, body FROM messages WHERE conversation_id = ? AND body IS NOT NULL ORDER BY id DESC LIMIT 20', conversationId).reverse()
  const msgs: Anthropic.MessageParam[] = []
  for (const r of rows) {
    const role = r.direction === 'in' ? 'user' : 'assistant'
    const last = msgs[msgs.length - 1]
    if (last && last.role === role) last.content = `${last.content}\n${r.body}`
    else msgs.push({ role, content: r.body || '' })
  }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift()
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return []
  return msgs
}

/** Returns reply text, or { handoff: true } when the AI decides a human should take over. */
export async function aiReply(workspaceId: number, conversationId: number): Promise<{ text?: string; handoff?: boolean }> {
  checkLimit(workspaceId, 'ai_replies')
  const msgs = transcript(conversationId)
  if (!msgs.length) return {}
  const { text } = businessContext(workspaceId)
  const out = await complete(workspaceId, text, msgs, 600)
  if (!out || out.includes(HANDOFF)) return { handoff: true }
  return { text: out }
}

export async function aiSuggest(workspaceId: number, conversationId: number) {
  const msgs = transcript(conversationId)
  if (!msgs.length) throw bad('No customer message to reply to yet')
  const { text } = businessContext(workspaceId)
  const out = await complete(workspaceId, text + '\n\nYou are drafting a reply for a human agent to review. Never output the handoff token; draft the best polite reply instead.', msgs, 600)
  return out
}

export async function aiWrite(workspaceId: number, kind: 'template' | 'rewrite' | 'broadcast', brief: string, tone = 'friendly, professional') {
  const ws = get<{ name: string }>('SELECT name FROM workspaces WHERE id = ?', workspaceId)!
  const system = `You write WhatsApp marketing and support copy for the business "${ws.name}". Tone: ${tone}.
Output only the message text, no quotes or explanations. Keep it under 700 characters, scannable, with short lines and at most 3 emojis.
For templates, use {{1}}, {{2}} placeholders for personalised values (e.g. customer name) and follow WhatsApp template policy (no misleading claims).`
  const prompt = kind === 'rewrite' ? `Rewrite and improve this message:\n\n${brief}` : `Write a WhatsApp ${kind === 'template' ? 'message template body' : 'broadcast message'} for: ${brief}`
  return complete(workspaceId, system, [{ role: 'user', content: prompt }], 800)
}
