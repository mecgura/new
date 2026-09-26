import { useState } from 'react'
import { Link } from 'react-router-dom'
import { patch } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { inr, phone, titleCase, ago } from '../../lib/format'
import { Avatar, Loading, PageHeader, useToast, cx, Badge } from '../../components/ui'

type Col = { stage: string; contacts: { id: number; name: string | null; wa_id: string; deal_value: number; tags: string[]; owner_name: string | null; last_seen_at: string | null }[] }

const colors: Record<string, string> = { new: 'bg-sky-400', contacted: 'bg-violet-400', qualified: 'bg-amber-400', proposal: 'bg-orange-400', won: 'bg-brand', lost: 'bg-red-400' }

export default function Pipeline() {
  const { data, setData, reload } = useApi<{ stages: string[]; columns: Col[] }>('pipeline')
  const [drag, setDrag] = useState<{ id: number; from: string } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const t = useToast()
  if (!data) return <Loading />
  const move = async (to: string) => {
    if (!drag || drag.from === to) return
    const card = data.columns.find((c) => c.stage === drag.from)!.contacts.find((c) => c.id === drag.id)!
    setData({ ...data, columns: data.columns.map((c) => c.stage === drag.from ? { ...c, contacts: c.contacts.filter((x) => x.id !== drag.id) } : c.stage === to ? { ...c, contacts: [card, ...c.contacts] } : c) })
    try { await patch(`contacts/${drag.id}`, { stage: to }) } catch (e) { t.err(e); void reload() }
  }
  return (
    <>
      <PageHeader title="Leads pipeline" subtitle="Drag leads between stages. Stages update the contact and can be used in campaigns and flow conditions." />
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        {data.columns.map((col) => {
          const total = col.contacts.reduce((s, c) => s + (c.deal_value || 0), 0)
          return (
            <div key={col.stage} onDragOver={(e) => { e.preventDefault(); setOver(col.stage) }} onDragLeave={() => setOver(null)} onDrop={() => { setOver(null); void move(col.stage) }}
              className={cx('flex w-72 shrink-0 flex-col rounded-2xl border bg-panel transition', over === col.stage ? 'border-brand/60' : 'border-line')}>
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2"><span className={cx('size-2 rounded-full', colors[col.stage] ?? 'bg-muted')} /><span className="font-semibold text-white">{titleCase(col.stage)}</span><span className="text-xs text-muted">{col.contacts.length}</span></div>
                <span className="text-xs text-muted">{inr(total)}</span>
              </div>
              <div className="max-h-[calc(100svh-260px)] min-h-32 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
                {col.contacts.map((c) => (
                  <div key={c.id} draggable onDragStart={() => setDrag({ id: c.id, from: col.stage })} onDragEnd={() => setDrag(null)}
                    className="cursor-grab rounded-xl border border-line bg-card p-3 transition hover:border-line-strong active:cursor-grabbing">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={c.name || c.wa_id} className="size-7 text-[10px]" />
                      <Link to={`/app/contacts?open=${c.id}`} className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-white">{c.name || phone(c.wa_id)}</div></Link>
                      {c.deal_value > 0 && <span className="text-xs font-semibold text-brand-2">{inr(c.deal_value)}</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">{c.tags.slice(0, 3).map((x) => <Badge key={x}>{x}</Badge>)}</div>
                    <div className="mt-2 flex justify-between text-[11px] text-muted"><span>{c.owner_name ?? 'No owner'}</span><span>{c.last_seen_at ? ago(c.last_seen_at) : ''}</span></div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
