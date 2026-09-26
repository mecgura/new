export type Reply =
  | { type: 'text'; text: string }
  | { type: 'media'; media_type: 'image' | 'video' | 'document'; link: string; caption?: string }
  | { type: 'buttons'; text: string; buttons: string[]; footer?: string }
  | { type: 'list'; text: string; button: string; items: string[] }
  | { type: 'cta_url'; text: string; display_text: string; url: string }

export const emptyReply: Reply = { type: 'text', text: '' }

export function replyText(r?: Reply | null) {
  if (!r) return ''
  return r.type === 'media' ? (r.caption || `[${r.media_type}]`) : r.text
}
