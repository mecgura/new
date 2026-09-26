import { Globe, Code2 } from 'lucide-react'
import { cx } from './ui'
import { CHANNELS } from '../lib/channels'

const Wa = (p: { className?: string }) => <svg viewBox="0 0 24 24" fill="currentColor" className={p.className}><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2.1 1-2.4c.3-.3.6-.3.8-.3h.6c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.3 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l2 1c.3.1.5.2.5.3.1.2.1.8-.1 1.4z" /></svg>
const Ms = (p: { className?: string }) => <svg viewBox="0 0 24 24" fill="currentColor" className={p.className}><path d="M12 2C6.4 2 2 6.1 2 11.7c0 2.9 1.2 5.5 3.2 7.2V22l3-1.6c1.2.3 2.4.5 3.8.5 5.6 0 10-4.1 10-9.7S17.6 2 12 2zm1 12.9-2.6-2.7-5 2.7 5.5-5.8 2.6 2.7 4.9-2.7-5.4 5.8z" /></svg>
const Ig = (p: { className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={p.className}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>

export function ChannelGlyph({ channel, className }: { channel?: string | null; className?: string }) {
  switch (channel ?? 'whatsapp') {
    case 'web': return <Globe className={className} />
    case 'messenger': return <Ms className={className} />
    case 'instagram': return <Ig className={className} />
    case 'api': return <Code2 className={className} />
    default: return <Wa className={className} />
  }
}

/** Small round channel badge, e.g. over an avatar. */
export function ChannelBadge({ channel, className }: { channel?: string | null; className?: string }) {
  const c = CHANNELS[channel ?? 'whatsapp'] ?? CHANNELS.whatsapp
  return <span title={c.label} className={cx('grid size-4 place-items-center rounded-full ring-2 ring-panel', c.color, className)}><ChannelGlyph channel={channel} className="size-2.5" /></span>
}
