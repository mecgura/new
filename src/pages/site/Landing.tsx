import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  MessagesSquare, Megaphone, Workflow, Sparkles, Users, ShoppingBag, BarChart3, Code2, Smartphone, ShieldCheck, Repeat, Bot,
  ArrowRight, Check, CheckCheck, Zap, Building2, GraduationCap, HeartPulse, Home, Plane, Store, Mail, Phone, MessageCircle, ChevronDown, Send, Search,
} from 'lucide-react'
import SiteLayout from './SiteLayout'
import { BRAND } from '../../lib/brand'
import { api } from '../../lib/api'
import { Button, Input, Textarea, useToast, cx } from '../../components/ui'

type Plan = { id: number; code: string; name: string; tagline: string; price_monthly: number; price_yearly: number; limits: Record<string, number>; features: string[] }

function HeroMock() {
  const chats = [['Priya Kaur', 'Is the festive offer still on?', '2m', 2], ['Aman Sharma', '✅ Payment received ₹4,999', '8m', 0], ['Rohit Verma', 'Book a demo for Saturday', '14m', 1], ['Simran Gill', 'Thanks! 🙌', '1h', 0]] as const
  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <div className="absolute -inset-10 -z-10 rounded-full bg-brand/20 blur-3xl" />
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-panel/90 shadow-[0_40px_120px_-30px_rgba(16,185,129,.45)] backdrop-blur">
        <div className="flex items-center gap-1.5 border-b border-line px-4 py-3">
          <span className="size-2.5 rounded-full bg-red-400/70" /><span className="size-2.5 rounded-full bg-amber-400/70" /><span className="size-2.5 rounded-full bg-brand/70" />
          <span className="ml-3 text-[11px] text-muted">{BRAND.domain}/app/inbox</span>
        </div>
        <div className="grid grid-cols-[180px_1fr] max-sm:grid-cols-1">
          <div className="border-r border-line max-sm:hidden">
            <div className="m-2 flex items-center gap-2 rounded-lg bg-raised px-2 py-1.5 text-[11px] text-muted"><Search className="size-3" />Search chats</div>
            {chats.map(([n, m, t, u], i) => (
              <div key={n} className={cx('flex gap-2 px-3 py-2.5', i === 0 && 'bg-brand/10')}>
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500/40 to-teal-700/40 text-[10px] font-semibold">{n[0]}</span>
                <div className="min-w-0 flex-1"><div className="flex justify-between text-[11px]"><b className="truncate font-medium text-white">{n}</b><span className="text-muted">{t}</span></div>
                  <div className="flex justify-between gap-1 text-[10.5px] text-muted"><span className="truncate">{m}</span>{u > 0 && <span className="grid size-4 shrink-0 place-items-center rounded-full bg-brand text-[9px] font-bold text-ink">{u}</span>}</div></div>
              </div>
            ))}
          </div>
          <div className="wa-bg flex flex-col">
            <div className="flex items-center justify-between border-b border-line bg-panel/80 px-4 py-2.5">
              <div className="text-xs"><div className="font-semibold text-white">Priya Kaur</div><div className="text-[10px] text-brand-2">● Assigned to you · Tag: vip</div></div>
              <span className="rounded-md bg-brand/15 px-2 py-0.5 text-[10px] text-brand-2">Open</span>
            </div>
            <div className="flex-1 space-y-2 p-4 text-[12px]">
              <div className="max-w-[78%] rounded-xl rounded-tl-sm bg-[#1f2c33] px-3 py-2 text-[#e9edef]">Hi! Is the festive offer still on? 🎉</div>
              <div className="ml-auto max-w-[82%] rounded-xl rounded-tr-sm bg-[#005c4b] px-3 py-2 text-[#e9edef]">Yes Priya! Flat 25% off till Sunday. Want me to share the catalogue?<div className="mt-0.5 flex justify-end gap-1 text-[9px] text-[#8fd6c4]">AI · 12:31 <CheckCheck className="size-3 text-sky-300" /></div></div>
              <div className="ml-auto max-w-[82%] overflow-hidden rounded-xl bg-[#005c4b] text-[#e9edef]"><div className="px-3 py-2">💳 Payment request — Amount: ₹4,999</div><div className="border-t border-white/10 py-1.5 text-center text-[11px] text-sky-300">↗ Pay now</div></div>
            </div>
            <div className="m-3 flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-[11px] text-muted"><Sparkles className="size-3.5 text-brand" />Type a reply or use / for quick replies<Send className="ml-auto size-3.5 text-brand" /></div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-6 -left-4 hidden rounded-xl border border-line-strong bg-panel/95 p-3 shadow-2xl sm:block">
        <div className="text-[10px] uppercase tracking-wider text-muted">Campaign · Diwali Sale</div>
        <div className="mt-1 flex items-end gap-3"><div><div className="font-display text-xl font-bold text-white">4,812</div><div className="text-[10px] text-muted">delivered</div></div><div><div className="font-display text-xl font-bold text-brand-2">3,907</div><div className="text-[10px] text-muted">read</div></div></div>
      </div>
      <div className="absolute -right-3 -top-5 hidden rounded-xl border border-brand/30 bg-panel/95 px-3 py-2 text-[11px] text-white shadow-2xl sm:flex sm:items-center sm:gap-2"><Workflow className="size-4 text-brand" />Lead flow → tagged <b className="text-brand-2">hot-lead</b></div>
    </div>
  )
}

const FEATURES = [
  { icon: MessagesSquare, t: 'Shared team inbox', d: 'Every WhatsApp chat in one inbox. Assign, transfer, add notes, use quick replies and see who is handling what — in real time.' },
  { icon: Megaphone, t: 'Bulk campaigns', d: 'Send approved templates to thousands of contacts by tag, stage or list. Schedule, personalise and track delivered, read and replied.' },
  { icon: Workflow, t: 'No-code flow builder', d: 'Build lead capture, booking and support journeys with buttons, questions, conditions, delays, webhooks and AI steps.' },
  { icon: Sparkles, t: 'AI assistant', d: 'Trained on your business knowledge. Auto-replies 24/7 in English, Hindi, Punjabi or Hinglish — and hands over to a human when needed.' },
  { icon: Bot, t: 'Keyword chatbot', d: 'Instant replies for pricing, timings, location and FAQs. Welcome and away messages with business hours.' },
  { icon: Repeat, t: 'Follow-up sequences', d: 'Drip messages that nurture leads automatically and stop the moment the customer replies.' },
  { icon: Users, t: 'CRM & leads pipeline', d: 'Contacts with tags, custom fields, owners, deal value and a drag-and-drop pipeline from new lead to won.' },
  { icon: ShoppingBag, t: 'Catalogue & payments', d: 'Share products, receive WhatsApp cart orders and collect payments with Razorpay payment links inside the chat.' },
  { icon: BarChart3, t: 'Analytics', d: 'Message volumes, campaign funnels, busy hours, bot performance and agent response times.' },
  { icon: Smartphone, t: 'Multiple numbers', d: 'Connect several WhatsApp numbers — branches, departments or brands — under one workspace.' },
  { icon: Code2, t: 'API & webhooks', d: 'REST API, API keys and signed webhooks to connect your website, CRM, Zapier, Make or custom apps.' },
  { icon: ShieldCheck, t: 'Roles & permissions', d: 'Owner, admin, manager, agent and viewer roles. Agents see only their chats. Audit log for key actions.' },
]

const SOLUTIONS = [
  { icon: Store, t: 'Retail & D2C', d: 'Catalogue, cart orders, payment links, abandoned-cart follow-ups and festive campaigns.' },
  { icon: GraduationCap, t: 'Education & coaching', d: 'Admission enquiries, counselling flows, fee reminders and batch updates.' },
  { icon: Home, t: 'Real estate', d: 'Capture budget & location, share brochures, book site visits and route to the right agent.' },
  { icon: HeartPulse, t: 'Clinics & wellness', d: 'Appointment booking, reminders, reports and post-visit follow-ups.' },
  { icon: Plane, t: 'Travel & hospitality', d: 'Package enquiries, itineraries, payment collection and trip updates.' },
  { icon: Building2, t: 'Agencies', d: 'Run WhatsApp for many clients from one login — separate workspaces, plans and teams.' },
]

const FAQ = [
  ['Is this the official WhatsApp Business API?', 'Yes. MECGURA WhatsApp connects to the official WhatsApp Business Platform (Cloud API) by Meta. Your number is verified under your own Meta Business account.'],
  ['Can I use my existing WhatsApp number?', 'Yes, if it is not active on the WhatsApp or WhatsApp Business app — or you can delete it from the app and migrate it. Our team guides you through it.'],
  ['What does Meta charge for messages?', 'Meta charges per message/conversation based on category (marketing, utility, authentication) and country. These charges are billed by Meta separately from your MECGURA plan. Service replies within 24 hours of a customer message are free.'],
  ['Can I try before connecting my number?', 'Yes. Every workspace gets a sandbox number so you can test the inbox, chatbot, flows and campaigns before going live.'],
  ['Do you help with setup and green tick?', `Yes. Our onboarding team helps with Meta Business verification, number connection, templates and your first flows. Call ${BRAND.phone} or email ${BRAND.email}.`],
  ['Can agencies manage multiple clients?', 'Yes. Create a separate workspace for each client, each with its own numbers, team, plan and data.'],
]

function Pricing() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [yearly, setYearly] = useState(false)
  useEffect(() => { api<Plan[]>('/api/public/plans').then(setPlans).catch(() => undefined) }, [])
  const L = (n: number) => (n < 0 ? 'Unlimited' : n.toLocaleString('en-IN'))
  const featureLabel: Record<string, string> = { ai: 'AI assistant', api: 'REST API', webhooks: 'Webhooks', catalog: 'Catalogue & orders', payments: 'Razorpay payments', flows: 'Flow builder', sequences: 'Follow-up sequences', priority_support: 'Priority support' }
  return (
    <section id="pricing" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[.2em] text-brand">Pricing</p>
        <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">Simple plans. Start with a 14-day free trial.</h2>
        <p className="mt-3 text-muted">No setup fee on self-serve plans. Meta&apos;s WhatsApp message charges are billed separately at Meta&apos;s rates.</p>
        <div className="mt-6 inline-flex rounded-xl border border-line bg-panel p-1 text-sm">
          <button onClick={() => setYearly(false)} className={cx('rounded-lg px-4 py-1.5', !yearly ? 'bg-raised text-white' : 'text-muted')}>Monthly</button>
          <button onClick={() => setYearly(true)} className={cx('rounded-lg px-4 py-1.5', yearly ? 'bg-raised text-white' : 'text-muted')}>Yearly <span className="text-brand-2">· 2 months free</span></button>
        </div>
      </div>
      <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => {
          const hot = p.code === 'growth'
          const price = yearly ? p.price_yearly : p.price_monthly
          return (
            <div key={p.id} className={cx('relative flex flex-col rounded-2xl border p-6', hot ? 'border-brand/50 bg-gradient-to-b from-brand/10 to-card shadow-[0_20px_60px_-25px_rgba(16,185,129,.6)]' : 'border-line bg-card')}>
              {hot && <span className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-0.5 text-xs font-semibold text-ink">Most popular</span>}
              <h3 className="font-display text-lg font-bold text-white">{p.name}</h3>
              <p className="mt-1 min-h-10 text-sm text-muted">{p.tagline}</p>
              <div className="mt-5">{price ? <><span className="font-display text-4xl font-bold text-white">₹{price.toLocaleString('en-IN')}</span><span className="text-sm text-muted">/{yearly ? 'year' : 'month'}</span><div className="text-xs text-muted">+ GST</div></> : <span className="font-display text-3xl font-bold text-white">Custom</span>}</div>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {[`${L(p.limits.numbers)} WhatsApp number${p.limits.numbers === 1 ? '' : 's'}`, `${L(p.limits.users)} team members`, `${L(p.limits.contacts)} contacts`, `${L(p.limits.messages)} messages / month`, `${L(p.limits.flows)} automation flows`, `${L(p.limits.ai_replies)} AI replies / month`, 'Team inbox, CRM & campaigns', ...p.features.filter((f) => !['flows'].includes(f)).map((f) => featureLabel[f] ?? f)]
                  .map((f) => <li key={f} className="flex gap-2 text-soft"><Check className="mt-0.5 size-4 shrink-0 text-brand" />{f}</li>)}
              </ul>
              {price ? <Link to={`/signup?plan=${p.code}`} className={cx('mt-7 rounded-xl py-2.5 text-center text-sm font-semibold', hot ? 'bg-brand text-ink hover:bg-brand-2' : 'border border-line-strong text-white hover:border-brand/50')}>Start free trial</Link>
                : <a href="#contact" className="mt-7 rounded-xl border border-line-strong py-2.5 text-center text-sm font-semibold text-white hover:border-brand/50">Talk to sales</a>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Contact() {
  const t = useToast()
  const [f, setF] = useState({ name: '', email: '', phone: '', company: '', message: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <section id="contact" className="scroll-mt-20 border-t border-line bg-panel/50">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.2em] text-brand">Contact</p>
          <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">Let&apos;s get your business live on WhatsApp.</h2>
          <p className="mt-4 max-w-md text-muted">Book a free demo, ask about pricing or get help with Meta verification. The MECGURA team usually replies within a few working hours.</p>
          <div className="mt-8 space-y-4">
            {[[Mail, 'Email', BRAND.email, `mailto:${BRAND.email}`], [Phone, 'Phone', BRAND.phone, BRAND.phoneHref], [MessageCircle, 'WhatsApp', BRAND.phone, BRAND.whatsappHref]].map(([I, l, v, h]) => {
              const Icon = I as typeof Mail
              return <a key={l as string} href={h as string} className="flex items-center gap-4 rounded-2xl border border-line bg-card p-4 transition hover:border-brand/40">
                <span className="grid size-11 place-items-center rounded-xl bg-brand/10 text-brand"><Icon className="size-5" /></span>
                <span><span className="block text-xs text-muted">{l as string}</span><span className="block font-medium text-white">{v as string}</span></span>
              </a>
            })}
          </div>
        </div>
        <form className="rounded-2xl border border-line bg-card p-6 sm:p-8" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true)
          try { await api('/api/public/contact', { body: f }); setDone(true); t.ok('Thanks! We will get back to you shortly.') } catch (err) { t.err(err) } finally { setBusy(false) }
        }}>
          {done ? <div className="grid h-full place-items-center py-16 text-center"><div><CheckCheck className="mx-auto size-10 text-brand" /><h3 className="mt-4 font-display text-xl font-semibold text-white">Message received</h3><p className="mt-2 text-sm text-muted">Our team will contact you soon. For urgent help call {BRAND.phone}.</p></div></div> : <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input required placeholder="Your name" value={f.name} onChange={set('name')} />
              <Input required type="email" placeholder="Work email" value={f.email} onChange={set('email')} />
              <Input placeholder="Mobile number" value={f.phone} onChange={set('phone')} />
              <Input placeholder="Business name" value={f.company} onChange={set('company')} />
            </div>
            <Textarea className="mt-4" rows={5} placeholder="What would you like to automate on WhatsApp?" value={f.message} onChange={set('message')} />
            <Button className="mt-5 w-full" size="lg" loading={busy}>Send message</Button>
            <p className="mt-3 text-center text-xs text-muted">By submitting you agree to be contacted by MECGURA about your enquiry.</p>
          </>}
        </form>
      </div>
    </section>
  )
}

export default function Landing() {
  const [faq, setFaq] = useState<number | null>(0)
  return (
    <SiteLayout>
      {/* Hero */}
      <section className="relative">
        <div className="grid-bg absolute inset-0 [mask-image:radial-gradient(70%_60%_at_50%_0%,#000,transparent)]" />
        <div className="glow absolute inset-0" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pb-24 pt-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div className="rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-medium text-brand-2"><ShieldCheck className="size-3.5" />Official WhatsApp Business API platform</span>
            <h1 className="mt-6 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Sell, support & automate on <span className="text-gradient">WhatsApp</span> — from one workspace.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-soft">MECGURA WhatsApp gives your team a shared inbox, bulk campaigns, no-code chatbots, an AI assistant, CRM and payments — built for Indian businesses.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup" className="inline-flex items-center gap-2 rounded-xl bg-brand px-6 py-3.5 font-semibold text-ink shadow-[0_10px_40px_-10px_rgba(16,185,129,.9)] hover:bg-brand-2">Start 14-day free trial <ArrowRight className="size-4" /></Link>
              <a href="#contact" className="inline-flex items-center gap-2 rounded-xl border border-line-strong px-6 py-3.5 font-semibold text-white hover:border-brand/50">Book a live demo</a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              {['No credit card for trial', 'Sandbox number included', 'Setup help from MECGURA'].map((t) => <span key={t} className="flex items-center gap-1.5"><Check className="size-4 text-brand" />{t}</span>)}
            </div>
          </div>
          <div className="rise [animation-delay:.15s]"><HeroMock /></div>
        </div>
      </section>

      {/* Capability strip */}
      <section className="border-y border-line bg-panel/60">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-10 sm:px-6 md:grid-cols-4">
          {[['12+', 'modules in one platform'], ['24/7', 'AI & chatbot replies'], ['Multi', 'numbers, teams & brands'], ['1 click', 'Razorpay payment links']].map(([a, b]) => (
            <div key={b}><div className="font-display text-3xl font-bold text-white">{a}</div><div className="mt-1 text-sm text-muted">{b}</div></div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[.2em] text-brand">Platform</p>
          <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">Everything your business needs on WhatsApp</h2>
          <p className="mt-3 text-muted">One login for conversations, marketing, automation and sales — no juggling five different tools.</p>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.t} className="group rounded-2xl border border-line bg-card p-6 transition hover:-translate-y-0.5 hover:border-brand/40">
              <span className="grid size-11 place-items-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/20 transition group-hover:bg-brand group-hover:text-ink"><f.icon className="size-5" /></span>
              <h3 className="mt-5 font-display text-lg font-semibold text-white">{f.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Automation spotlight */}
      <section className="border-y border-line bg-gradient-to-b from-panel to-ink">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 py-24 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.2em] text-brand">Automation</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">Turn every “Hi” into a qualified lead — automatically.</h2>
            <p className="mt-4 text-muted">Design the conversation once. MECGURA asks the right questions, saves answers to your CRM, tags hot leads, collects payments and alerts your team only when a human is needed.</p>
            <ul className="mt-6 space-y-3 text-sm text-soft">
              {['Buttons, lists, questions with validation', 'Conditions on tags, fields and answers', 'Delays, webhooks to your CRM, AI replies', 'Round-robin assignment & human handoff'].map((x) => <li key={x} className="flex gap-2"><Zap className="mt-0.5 size-4 text-brand" />{x}</li>)}
            </ul>
          </div>
          <div className="relative rounded-2xl border border-line bg-card p-6">
            {[['Trigger', 'Customer says “hi”', 'bg-sky-400/15 text-sky-300'], ['Buttons', 'What are you looking for? · Website · Marketing · WhatsApp', 'bg-brand/15 text-brand-2'], ['Question', 'What is your business name? → saved as {{business_name}}', 'bg-violet-400/15 text-violet-300'], ['Action', 'Add tag “hot-lead” · Assign round-robin', 'bg-amber-400/15 text-amber-300'], ['AI / Handoff', 'Answer FAQs, or notify the sales team', 'bg-rose-400/15 text-rose-300']].map(([k, v, c], i, a) => (
              <div key={k} className="relative pl-10">
                <span className={cx('absolute left-0 top-1 grid size-7 place-items-center rounded-lg text-[11px] font-bold', c)}>{i + 1}</span>
                {i < a.length - 1 && <span className="absolute left-3.5 top-9 h-[calc(100%-24px)] w-px bg-line-strong" />}
                <div className="pb-5"><div className="text-xs font-semibold uppercase tracking-wider text-muted">{k}</div><div className="mt-1 rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm text-white">{v}</div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Solutions */}
      <section id="solutions" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-24 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[.2em] text-brand">Solutions</p>
          <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">Built for how your industry sells</h2>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map((s) => (
            <div key={s.t} className="flex gap-4 rounded-2xl border border-line bg-card p-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/5 text-brand-2"><s.icon className="size-5" /></span>
              <div><h3 className="font-semibold text-white">{s.t}</h3><p className="mt-1 text-sm text-muted">{s.d}</p></div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-line bg-panel/50">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <h2 className="text-center font-display text-3xl font-bold text-white sm:text-4xl">Live in three steps</h2>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {[['Create your workspace', 'Sign up and explore everything with the free sandbox number.'], ['Connect your WhatsApp number', 'Link your number through Meta in minutes — our team helps with verification.'], ['Launch & grow', 'Import contacts, get templates approved, switch on chatbots, flows and campaigns.']].map(([t, d], i) => (
              <div key={t} className="rounded-2xl border border-line bg-card p-6">
                <div className="font-display text-5xl font-extrabold text-brand/25">0{i + 1}</div>
                <h3 className="mt-3 font-display text-lg font-semibold text-white">{t}</h3><p className="mt-2 text-sm text-muted">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Pricing />

      {/* Developers */}
      <section className="border-y border-line bg-panel/50">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.2em] text-brand">Developers</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-white sm:text-4xl">Connect WhatsApp to anything</h2>
            <p className="mt-4 text-muted">Send messages from your website, CRM or app with a simple REST API. Receive signed webhooks for messages, statuses, orders and payments.</p>
            <Link to="/docs" className="mt-6 inline-flex items-center gap-2 font-semibold text-brand-2 hover:text-white">Read the API docs <ArrowRight className="size-4" /></Link>
          </div>
          <pre className="overflow-x-auto rounded-2xl border border-line bg-[#070b0d] p-5 text-[12.5px] leading-relaxed text-soft"><code>{`curl https://${BRAND.domain}/api/v1/messages \\
  -H "Authorization: Bearer mk_live_••••" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "919876543210",
    "type": "template",
    "template": "order_update",
    "variables": ["Aman", "1024", "shipped"]
  }'`}</code></pre>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
        <h2 className="text-center font-display text-3xl font-bold text-white sm:text-4xl">Frequently asked questions</h2>
        <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-card">
          {FAQ.map(([q, a], i) => (
            <div key={q}>
              <button onClick={() => setFaq(faq === i ? null : i)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium text-white">
                {q}<ChevronDown className={cx('size-4 shrink-0 text-muted transition', faq === i && 'rotate-180')} />
              </button>
              {faq === i && <p className="px-5 pb-5 text-sm leading-relaxed text-muted">{a}</p>}
            </div>
          ))}
        </div>
      </section>

      <Contact />
    </SiteLayout>
  )
}
