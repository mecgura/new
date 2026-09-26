import type { Reply } from './reply'
import type { TplComponent } from '../components/WhatsAppPreview'

export type Limits = Record<'numbers' | 'users' | 'contacts' | 'messages' | 'flows' | 'ai_replies' | 'campaigns', number>
export type Plan = { id: number; code: string; name: string; tagline: string; price_monthly: number; price_yearly: number; limits: Limits; features: string[]; is_public: number; sort: number }
export type Usage = Record<keyof Limits, { used: number; limit: number }>

export type WaNumber = { id: number; label: string; phone_number_id: string; waba_id: string | null; display_phone: string | null; verified_name: string | null; quality_rating: string | null; messaging_limit: string | null; status: string; is_default: number; is_demo: number; created_at: string }

export type Contact = { id: number; wa_id: string; name: string | null; email: string | null; tags: string[]; attributes: Record<string, unknown>; stage: string; deal_value: number; lead_score: number; owner_id: number | null; owner_name?: string; source: string; opted_out: number; last_seen_at: string | null; created_at: string }

export type Conversation = { id: number; contact_id: number; number_id: number; status: string; assigned_to: number | null; agent_name: string | null; unread_count: number; bot_paused: number; last_message_at: string; last_inbound_at: string | null; last_preview: string | null; contact_name: string | null; wa_id: string; tags: string[]; stage: string; number_label: string | null }

export type Message = { id: number; conversation_id: number; direction: 'in' | 'out'; type: string; body: string | null; payload: Record<string, unknown>; status: string; error: string | null; sent_by: string | null; agent_name: string | null; created_at: string }

export type Template = { id: number; name: string; language: string; category: string; status: string; components: TplComponent[]; rejection_reason: string | null; updated_at: string }

export type Campaign = { id: number; name: string; status: string; template_id: number; template_name?: string; total: number; sent: number; delivered: number; read: number; failed: number; replied: number; scheduled_at: string | null; started_at: string | null; completed_at: string | null; created_at: string; audience: Record<string, unknown>; created_by_name?: string }

export type BotRule = { id: number; name: string; match_type: string; keywords: string[]; reply: Reply; priority: number; is_active: number; hits: number }

export type FlowNode = { id: string; type: string; data: Record<string, unknown>; next?: string | null; branches?: Record<string, string | null>; x?: number; y?: number }
export type Flow = { id: number; name: string; description: string | null; trigger: { type: string; value?: string; match?: string }; nodes: FlowNode[]; is_active: number; runs: number; completions: number; steps?: number; updated_at: string }

export type Member = { id: number; user_id: number; name: string; email: string; role: string; is_online: number; open_chats: number; last_login_at: string | null }
