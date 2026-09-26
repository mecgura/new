import { useState } from 'react'

type Series = { key: string; label: string; color: string }

/** Lightweight SVG area/line chart for daily series. */
export function AreaChart({ data, series, height = 220, xKey = 'date' }: { data: Record<string, number | string>[]; series: Series[]; height?: number; xKey?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 720, H = height, P = { l: 36, r: 12, t: 12, b: 26 }
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)))
  const nice = Math.ceil(max / 4) * 4 || 4
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, data.length - 1)
  const y = (v: number) => H - P.b - (v / nice) * (H - P.t - P.b)
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" onMouseLeave={() => setHover(null)}>
        <defs>{series.map((s) => (
          <linearGradient key={s.key} id={`g-${s.key}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity=".28" /><stop offset="100%" stopColor={s.color} stopOpacity="0" /></linearGradient>
        ))}</defs>
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (nice / 4) * i
          return <g key={i}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#1c272d" /><text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#6b7b83">{v}</text></g>
        })}
        {series.map((s) => {
          const pts = data.map((d, i) => `${x(i)},${y(Number(d[s.key]) || 0)}`)
          return <g key={s.key}>
            <path d={`M${pts.join(' L')} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#g-${s.key})`} />
            <path d={`M${pts.join(' L')}`} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
          </g>
        })}
        {data.map((d, i) => (
          <g key={i}>
            {(i % Math.ceil(data.length / 7) === 0 || i === data.length - 1) && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b7b83">{String(d[xKey]).slice(5)}</text>}
            <rect x={x(i) - (W / data.length) / 2} y={0} width={W / data.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="#34d399" strokeDasharray="3 3" opacity=".5" />}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-2 rounded-lg border border-line-strong bg-panel px-3 py-2 text-xs shadow-xl" style={{ left: `${Math.min(80, (x(hover) / W) * 100)}%` }}>
          <div className="mb-1 font-medium text-white">{String(data[hover][xKey])}</div>
          {series.map((s) => <div key={s.key} className="flex items-center gap-2 text-soft"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}: <b className="text-white">{data[hover][s.key]}</b></div>)}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">{series.map((s) => <span key={s.key} className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: s.color }} />{s.label}</span>)}</div>
    </div>
  )
}

export function BarList({ items, color = '#10b981' }: { items: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  if (!items.length) return <p className="py-6 text-center text-sm text-muted">No data yet</p>
  return (
    <div className="space-y-2.5">
      {items.map((i) => (
        <div key={i.label}>
          <div className="mb-1 flex justify-between text-xs"><span className="truncate text-soft">{i.label}</span><span className="font-medium text-white">{i.value.toLocaleString('en-IN')}</span></div>
          <div className="h-1.5 rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  )
}

export function Columns({ data, height = 120 }: { data: { label: string; value: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d) => (
        <div key={d.label} className="group relative flex-1">
          <div className="rounded-t bg-brand/70 transition group-hover:bg-brand-2" style={{ height: `${Math.max(2, (d.value / max) * height)}px` }} />
          <div className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-panel px-1.5 py-0.5 text-[10px] text-white ring-1 ring-line group-hover:block">{d.label}: {d.value}</div>
        </div>
      ))}
    </div>
  )
}

export function Donut({ parts, size = 132 }: { parts: { label: string; value: number; color: string }[]; size?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  const r = 50, c = 2 * Math.PI * r
  const offsets = parts.map((_, i) => parts.slice(0, i).reduce((s, p) => s + (p.value / total) * c, 0))
  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} viewBox="0 0 120 120" className="-rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#1c272d" strokeWidth="14" />
        {parts.map((p, i) => {
          const len = (p.value / total) * c
          return <circle key={p.label} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="14" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offsets[i]} />
        })}
      </svg>
      <div className="space-y-1.5 text-xs">{parts.map((p) => <div key={p.label} className="flex items-center gap-2 text-soft"><span className="size-2.5 rounded-sm" style={{ background: p.color }} />{p.label}<b className="ml-auto pl-3 text-white">{p.value.toLocaleString('en-IN')}</b></div>)}</div>
    </div>
  )
}
