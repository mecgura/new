import { useState } from 'react'
import { Check, Crown, Mail, Phone } from 'lucide-react'
import { post } from '../../lib/api'
import { useApi, useNow } from '../../lib/hooks'
import { useSession } from '../../lib/session'
import { date, inr, limitLabel, num, titleCase } from '../../lib/format'
import { Badge, Button, Card, Loading, PageHeader, Progress, Table, Td, useToast, statusTone, cx } from '../../components/ui'
import { BRAND } from '../../lib/brand'
import type { Plan, Usage } from '../../lib/types'

type B = { plan: Plan; usage: Usage; plans: Plan[]; subscription_status: string; trial_ends_at: string | null; current_period_end: string | null; invoices: { id: number; plan_name: string; amount: number; cycle: string; status: string; created_at: string; period_end: string | null }[]; online_payments: boolean }
type Rzp = { open: () => void }
declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => Rzp } }

const loadRzp = () => new Promise<void>((res, rej) => {
  if (window.Razorpay) return res()
  const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = () => res(); s.onerror = rej; document.body.appendChild(s)
})

export default function Billing() {
  const t = useToast()
  const { refresh } = useSession()
  const { data, reload } = useApi<B>('billing')
  const [yearly, setYearly] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const now = useNow(60000)
  if (!data) return <Loading />
  const trialing = data.subscription_status === 'trialing'
  const daysLeft = data.current_period_end ? Math.max(0, Math.ceil((new Date(data.current_period_end).getTime() - now) / 86400000)) : 0

  const checkout = async (p: Plan) => {
    setBusy(p.id)
    try {
      const o = await post<{ order_id: string; amount: number; currency: string; key_id: string; name: string; description: string; prefill: Record<string, string> }>('billing/checkout', { plan_id: p.id, cycle: yearly ? 'yearly' : 'monthly' })
      await loadRzp()
      new window.Razorpay!({
        key: o.key_id, amount: o.amount, currency: o.currency, order_id: o.order_id, name: o.name, description: o.description, prefill: o.prefill, theme: { color: '#10b981' },
        handler: async (r: Record<string, string>) => { try { await post('billing/verify', r); t.ok(`You are now on ${p.name} 🎉`); void reload(); void refresh() } catch (e) { t.err(e) } },
      }).open()
    } catch (e) { t.err(e) } finally { setBusy(null) }
  }

  return (
    <>
      <PageHeader title="Plan & billing" subtitle="Your subscription, usage and invoices." />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <div className="flex items-start justify-between"><div><div className="text-xs text-muted">Current plan</div><div className="mt-1 flex items-center gap-2 font-display text-2xl font-bold text-white"><Crown className="size-5 text-brand" />{data.plan.name}</div></div><Badge tone={statusTone(data.subscription_status)}>{data.subscription_status}</Badge></div>
          <p className="mt-3 text-sm text-muted">{trialing ? `Free trial — ${daysLeft} days left (ends ${date(data.current_period_end)})` : data.current_period_end ? `Renews / expires on ${date(data.current_period_end)}` : ''}</p>
          <div className="mt-5 rounded-xl border border-line bg-panel p-4 text-sm text-muted">Meta’s WhatsApp message charges are billed directly by Meta to the payment method in your WhatsApp Business Account.</div>
        </Card>
        <Card title="Usage this month">
          <div className="grid gap-4 sm:grid-cols-2">
            {(Object.entries(data.usage) as [string, { used: number; limit: number }][]).map(([k, u]) => (
              <div key={k}><div className="mb-1.5 flex justify-between text-xs"><span className="text-soft">{titleCase(k)}</span><span className="text-muted">{num(u.used)} / {limitLabel(u.limit)}</span></div><Progress value={u.used} max={u.limit} /></div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mb-4 mt-8 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-white">Change plan</h2>
        <div className="inline-flex rounded-xl border border-line bg-panel p-1 text-sm">
          <button onClick={() => setYearly(false)} className={cx('rounded-lg px-3 py-1', !yearly ? 'bg-raised text-white' : 'text-muted')}>Monthly</button>
          <button onClick={() => setYearly(true)} className={cx('rounded-lg px-3 py-1', yearly ? 'bg-raised text-white' : 'text-muted')}>Yearly</button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.plans.map((p) => {
          const price = yearly ? p.price_yearly : p.price_monthly
          const current = p.id === data.plan.id && !trialing
          return (
            <Card key={p.id} className={cx(p.id === data.plan.id && 'border-brand/50')}>
              <div className="font-display text-lg font-bold text-white">{p.name}</div>
              <div className="mt-2">{price ? <><span className="font-display text-2xl font-bold text-white">{inr(price)}</span><span className="text-xs text-muted">/{yearly ? 'yr' : 'mo'} + GST</span></> : <span className="font-display text-xl font-bold text-white">Custom</span>}</div>
              <ul className="mt-4 space-y-1.5 text-xs text-soft">
                {[`${limitLabel(p.limits.numbers)} numbers`, `${limitLabel(p.limits.users)} users`, `${limitLabel(p.limits.contacts)} contacts`, `${limitLabel(p.limits.messages)} msgs/mo`, `${limitLabel(p.limits.ai_replies)} AI replies`].map((x) => <li key={x} className="flex gap-1.5"><Check className="size-3.5 text-brand" />{x}</li>)}
              </ul>
              <div className="mt-5">
                {current ? <Button className="w-full" variant="subtle" disabled>Current plan</Button>
                  : price && data.online_payments ? <Button className="w-full" loading={busy === p.id} onClick={() => checkout(p)}>{trialing && p.id === data.plan.id ? 'Activate' : 'Choose'} {p.name}</Button>
                    : <a href={`mailto:${BRAND.email}?subject=${encodeURIComponent(`Activate ${p.name} plan`)}`}><Button className="w-full" variant="outline">Contact sales</Button></a>}
              </div>
            </Card>
          )
        })}
      </div>
      {!data.online_payments && <p className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted">To activate or upgrade, contact MECGURA: <a className="flex items-center gap-1 text-brand-2" href={`mailto:${BRAND.email}`}><Mail className="size-4" />{BRAND.email}</a><a className="flex items-center gap-1 text-brand-2" href={BRAND.phoneHref}><Phone className="size-4" />{BRAND.phone}</a></p>}

      <Card className="mt-8" title="Invoices" pad={false}>
        {data.invoices.length === 0 ? <p className="py-8 text-center text-sm text-muted">No invoices yet.</p> : (
          <Table head={['Date', 'Plan', 'Cycle', 'Amount', 'Status', 'Valid until']}>
            {data.invoices.map((i) => <tr key={i.id}><Td>{date(i.created_at)}</Td><Td className="text-white">{i.plan_name}</Td><Td>{i.cycle}</Td><Td>{inr(i.amount)}</Td><Td><Badge tone={statusTone(i.status)}>{i.status}</Badge></Td><Td>{date(i.period_end)}</Td></tr>)}
          </Table>
        )}
      </Card>
    </>
  )
}
