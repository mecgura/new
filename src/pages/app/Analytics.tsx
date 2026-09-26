import { useState } from 'react'
import { useApi } from '../../lib/hooks'
import { num, pct, inr, titleCase } from '../../lib/format'
import { Card, Loading, PageHeader, Select, Stat, Table, Td } from '../../components/ui'
import { AreaChart, BarList, Columns, Donut } from '../../components/charts'

type A = {
  series: { date: string; inbound: number; outbound: number; contacts: number }[]; statuses: { status: string; c: number }[]; by_sender: { sent_by: string; c: number }[]
  agents: { id: number; name: string; messages: number; resolved: number; open: number; avg_first_response_min: number | null }[]
  campaigns: { id: number; name: string; total: number; delivered: number; read: number; replied: number; failed: number }[]
  flows: { id: number; name: string; runs: number; completions: number }[]; bot_rules: { name: string; hits: number }[]; tags: { tag: string; c: number }[]; busy_hours: { hour: number; count: number }[]
  totals: { inbound: number; outbound: number; new_contacts: number; conversations: number; resolved: number; automated: number; revenue: number; orders: number; avg_first_response_min: number }
}
const colors: Record<string, string> = { read: '#38bdf8', delivered: '#10b981', sent: '#6b7b83', failed: '#f87171', queued: '#27353c' }
const mins = (m: number | null) => (!m ? '—' : m < 60 ? `${Math.round(m)}m` : `${(m / 60).toFixed(1)}h`)

export default function Analytics() {
  const [days, setDays] = useState(30)
  const { data } = useApi<A>(`analytics?days=${days}`)
  if (!data) return <Loading />
  const T = data.totals
  return (
    <>
      <PageHeader title="Analytics" subtitle="Conversations, automation, campaigns and team performance." actions={<Select className="w-40" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></Select>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Messages received" value={num(T.inbound)} />
        <Stat label="Messages sent" value={num(T.outbound)} hint={`${pct(T.automated, T.outbound)} automated`} />
        <Stat label="New contacts" value={num(T.new_contacts)} />
        <Stat label="Avg. first response" value={mins(T.avg_first_response_min)} hint={`${num(T.resolved)} chats resolved`} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <Card title="Message volume"><AreaChart data={data.series} series={[{ key: 'inbound', label: 'Received', color: '#38bdf8' }, { key: 'outbound', label: 'Sent', color: '#10b981' }, { key: 'contacts', label: 'New contacts', color: '#fbbf24' }]} /></Card>
        <Card title="Delivery status"><Donut parts={data.statuses.map((s) => ({ label: titleCase(s.status), value: s.c, color: colors[s.status] ?? '#8a9aa3' }))} />
          <div className="mt-6"><div className="mb-2 text-xs text-muted">Sent by</div><BarList items={data.by_sender.map((s) => ({ label: titleCase(s.sent_by || 'other'), value: s.c }))} /></div></Card>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card title="Busiest hours (customer messages, UTC)"><Columns data={data.busy_hours.map((h) => ({ label: `${h.hour}:00`, value: h.count }))} /><div className="mt-1 flex justify-between text-[10px] text-muted"><span>0h</span><span>12h</span><span>23h</span></div></Card>
        <Card title="Top chatbot rules"><BarList items={data.bot_rules.map((r) => ({ label: r.name, value: r.hits }))} /></Card>
        <Card title="Top tags"><BarList items={data.tags.map((t) => ({ label: t.tag, value: t.c }))} color="#38bdf8" /></Card>
      </div>
      <Card className="mt-5" title="Team performance" pad={false}>
        <Table head={['Agent', 'Messages sent', 'Resolved', 'Open now', 'Avg. first response']}>
          {data.agents.map((a) => <tr key={a.id}><Td className="text-white">{a.name}</Td><Td>{num(a.messages)}</Td><Td>{num(a.resolved)}</Td><Td>{num(a.open)}</Td><Td>{mins(a.avg_first_response_min)}</Td></tr>)}
        </Table>
      </Card>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Campaign funnel" pad={false}>
          <Table head={['Campaign', 'Delivered', 'Read', 'Replied']}>{data.campaigns.map((c) => <tr key={c.id}><Td className="text-white">{c.name}</Td><Td>{pct(c.delivered, c.total)}</Td><Td>{pct(c.read, c.total)}</Td><Td>{pct(c.replied, c.total)}</Td></tr>)}</Table>
          {data.campaigns.length === 0 && <p className="py-6 text-center text-sm text-muted">No campaigns in this period</p>}
        </Card>
        <Card title="Flows" pad={false}>
          <Table head={['Flow', 'Runs', 'Completed', 'Rate']}>{data.flows.map((f) => <tr key={f.id}><Td className="text-white">{f.name}</Td><Td>{num(f.runs)}</Td><Td>{num(f.completions)}</Td><Td>{pct(f.completions, f.runs)}</Td></tr>)}</Table>
          {data.flows.length === 0 && <p className="py-6 text-center text-sm text-muted">No flows yet</p>}
        </Card>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3"><Stat label="Revenue collected" value={inr(T.revenue)} /><Stat label="Orders" value={num(T.orders)} /></div>
    </>
  )
}
