import { Link, useSearchParams } from 'react-router-dom'
import { MessagesSquare, Users, Send, Workflow, IndianRupee, Smartphone, FileText, Megaphone, CheckCircle2, Circle, ArrowRight, UserCheck } from 'lucide-react'
import { useApi } from '../../lib/hooks'
import { useSession } from '../../lib/session'
import { Card, Stat, Loading, Badge, statusTone, PageHeader, Button } from '../../components/ui'
import { AreaChart, BarList } from '../../components/charts'
import { inr, num, pct, titleCase } from '../../lib/format'
import type { Campaign } from '../../lib/types'

type Dash = { open_chats: number; unassigned: number; contacts: number; new_contacts_7d: number; messages_today: number; active_flows: number; revenue_30d: number; numbers: number; templates: number;
  days: { date: string; inbound: number; outbound: number }[]; recent_campaigns: Campaign[]; stages: { stage: string; c: number }[] }

export default function Dashboard() {
  const { data } = useApi<Dash>('dashboard')
  const { user, ws } = useSession()
  const [params] = useSearchParams()
  if (!data) return <Loading />
  const steps = [
    { done: data.numbers > 0, t: 'Connect a WhatsApp number', d: 'Use the sandbox now, connect your Meta number when ready', to: '/app/numbers' },
    { done: data.templates > 0, t: 'Get a message template approved', d: 'Needed for campaigns and starting new chats', to: '/app/templates' },
    { done: data.contacts > 0, t: 'Import your contacts', d: 'Upload a CSV or add contacts manually', to: '/app/contacts' },
    { done: data.active_flows > 0, t: 'Switch on an automation', d: 'Chatbot rules, flows or the AI assistant', to: '/app/flows' },
  ]
  const doneCount = steps.filter((s) => s.done).length
  return (
    <>
      <PageHeader title={`${params.get('welcome') ? 'Welcome' : 'Hello'}, ${user?.name.split(' ')[0]} 👋`} subtitle={`Here is what is happening in ${ws?.name} today.`}
        actions={<><Link to="/app/campaigns?new=1"><Button variant="outline" icon={<Megaphone className="size-4" />}>New campaign</Button></Link><Link to="/app/inbox"><Button icon={<MessagesSquare className="size-4" />}>Open inbox</Button></Link></>} />

      {doneCount < steps.length && (
        <Card className="mb-6 overflow-hidden border-brand/25 bg-gradient-to-r from-brand/10 via-card to-card" pad={false}>
          <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center">
            <div className="lg:w-64">
              <h3 className="font-display font-semibold text-white">Go live checklist</h3>
              <p className="mt-1 text-sm text-muted">{doneCount} of {steps.length} done</p>
              <div className="mt-3 h-1.5 rounded-full bg-line"><div className="h-full rounded-full bg-brand" style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
            </div>
            <div className="grid flex-1 gap-2 sm:grid-cols-2">
              {steps.map((s) => (
                <Link key={s.t} to={s.to} className="group flex items-start gap-3 rounded-xl border border-line bg-panel/60 p-3 hover:border-brand/40">
                  {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-brand" /> : <Circle className="mt-0.5 size-5 shrink-0 text-line-strong" />}
                  <span className="min-w-0"><span className={`block text-sm font-medium ${s.done ? 'text-muted line-through' : 'text-white'}`}>{s.t}</span><span className="block text-xs text-muted">{s.d}</span></span>
                  <ArrowRight className="ml-auto mt-0.5 size-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open chats" value={num(data.open_chats)} hint={`${data.unassigned} unassigned`} icon={<MessagesSquare className="size-4" />} />
        <Stat label="Contacts" value={num(data.contacts)} hint={`+${data.new_contacts_7d} this week`} icon={<Users className="size-4" />} />
        <Stat label="Messages today" value={num(data.messages_today)} icon={<Send className="size-4" />} />
        <Stat label="Revenue (30 days)" value={inr(data.revenue_30d)} hint="via payment links" icon={<IndianRupee className="size-4" />} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.7fr_1fr]">
        <Card title="Messages — last 14 days" action={<Link to="/app/analytics" className="text-xs text-brand-2">Analytics →</Link>}>
          <AreaChart data={data.days} series={[{ key: 'inbound', label: 'Received', color: '#38bdf8' }, { key: 'outbound', label: 'Sent', color: '#10b981' }]} />
        </Card>
        <Card title="Leads by stage" action={<Link to="/app/pipeline" className="text-xs text-brand-2">Pipeline →</Link>}>
          <BarList items={data.stages.map((s) => ({ label: titleCase(s.stage), value: s.c }))} />
          <div className="mt-6 grid grid-cols-3 gap-2 text-center">
            {[[Smartphone, data.numbers, 'Numbers'], [FileText, data.templates, 'Templates'], [Workflow, data.active_flows, 'Live flows']].map(([I, v, l]) => {
              const Icon = I as typeof Smartphone
              return <div key={l as string} className="rounded-xl border border-line bg-panel p-3"><Icon className="mx-auto size-4 text-brand" /><div className="mt-1 font-display text-lg font-bold text-white">{v as number}</div><div className="text-[11px] text-muted">{l as string}</div></div>
            })}
          </div>
        </Card>
      </div>

      <Card className="mt-5" title="Recent campaigns" pad={false} action={<Link to="/app/campaigns" className="text-xs text-brand-2">All campaigns →</Link>}>
        {data.recent_campaigns.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">No campaigns yet. <Link to="/app/campaigns?new=1" className="text-brand-2">Send your first broadcast</Link></p> : (
          <div className="divide-y divide-line">
            {data.recent_campaigns.map((c) => (
              <Link key={c.id} to={`/app/campaigns/${c.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5 hover:bg-white/[.02]">
                <span className="min-w-40 flex-1 font-medium text-white">{c.name}</span>
                <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                <span className="text-xs text-muted">{num(c.total)} recipients</span>
                <span className="text-xs text-muted">Delivered {pct(c.delivered, c.total)}</span>
                <span className="text-xs text-muted">Read {pct(c.read, c.total)}</span>
                <span className="flex items-center gap-1 text-xs text-muted"><UserCheck className="size-3.5" />Replied {pct(c.replied, c.total)}</span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
