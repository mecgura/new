import { ExternalLink, Phone, Reply, Image as ImageIcon, FileText, Video } from 'lucide-react'
import type { ReactNode } from 'react'

export type TplComponent = { type: string; format?: string; text?: string; buttons?: { type: string; text?: string; url?: string; phone_number?: string }[] }

const fmt = (t: string) => t.split(/(\*[^*]+\*|_[^_]+_)/g).map((p, i) =>
  p.startsWith('*') && p.endsWith('*') ? <b key={i}>{p.slice(1, -1)}</b> : p.startsWith('_') && p.endsWith('_') ? <i key={i}>{p.slice(1, -1)}</i> : p)

/** Renders a WhatsApp-style bubble for templates and interactive replies. */
export function Bubble({ header, body, footer, buttons, media }: { header?: string; body: string; footer?: string; buttons?: { label: string; icon?: ReactNode }[]; media?: string }) {
  return (
    <div className="w-full max-w-[300px]">
      <div className="rounded-xl rounded-tl-sm bg-[#1f2c33] p-1.5 text-[13px] leading-snug text-[#e9edef] shadow">
        {media && <div className="mb-1 grid h-32 place-items-center rounded-lg bg-black/30 text-muted">{media === 'IMAGE' ? <ImageIcon /> : media === 'VIDEO' ? <Video /> : <FileText />}</div>}
        <div className="px-1.5 pb-1 pt-0.5">
          {header && <div className="mb-1 font-semibold">{header}</div>}
          <div className="whitespace-pre-wrap break-words">{fmt(body || ' ')}</div>
          {footer && <div className="mt-1 text-[11px] text-[#8696a0]">{footer}</div>}
          <div className="mt-0.5 text-right text-[10px] text-[#8696a0]">12:30</div>
        </div>
      </div>
      {buttons?.map((b, i) => (
        <div key={i} className="mt-0.5 flex items-center justify-center gap-1.5 rounded-lg bg-[#1f2c33] py-2 text-[13px] font-medium text-[#53bdeb]">{b.icon}{b.label}</div>
      ))}
    </div>
  )
}

export function TemplatePreview({ components, vars }: { components: TplComponent[]; vars?: string[] }) {
  const h = components.find((c) => c.type === 'HEADER')
  const b = components.find((c) => c.type === 'BODY')
  const f = components.find((c) => c.type === 'FOOTER')
  const btns = components.find((c) => c.type === 'BUTTONS')?.buttons ?? []
  const body = (b?.text ?? '').replace(/\{\{(\d+)\}\}/g, (m, n) => vars?.[Number(n) - 1] || m)
  return (
    <div className="wa-bg rounded-xl p-4">
      <Bubble header={h?.format === 'TEXT' ? h.text : undefined} media={h && h.format !== 'TEXT' ? h.format : undefined} body={body} footer={f?.text}
        buttons={btns.map((x) => ({ label: x.text || x.type, icon: x.type === 'URL' ? <ExternalLink className="size-3.5" /> : x.type === 'PHONE_NUMBER' ? <Phone className="size-3.5" /> : <Reply className="size-3.5" /> }))} />
    </div>
  )
}
