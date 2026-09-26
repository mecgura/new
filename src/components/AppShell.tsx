import { useState, type ReactNode } from 'react'
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, MessagesSquare, Users, KanbanSquare, Megaphone, FileText, Bot, Workflow, Sparkles, Repeat, ShoppingBag,
  BarChart3, Smartphone, UserCog, Code2, CreditCard, Settings, Bell, Menu, X, LogOut, ChevronDown, ShieldCheck, LifeBuoy, Check,
} from 'lucide-react'
import Logo from './Logo'
import { useSession } from '../lib/session'
import { useApi, useEvents, useNow } from '../lib/hooks'
import { post } from '../lib/api'
import { ago } from '../lib/format'
import { Avatar, cx } from './ui'
import { BRAND } from '../lib/brand'

type Item = { to: string; label: string; icon: typeof LayoutDashboard; perm?: string }
const NAV: { group: string; items: Item[] }[] = [
  { group: 'Engage', items: [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/app/inbox', label: 'Team Inbox', icon: MessagesSquare, perm: 'inbox.view' },
    { to: '/app/contacts', label: 'Contacts', icon: Users, perm: 'contacts.view' },
    { to: '/app/pipeline', label: 'Leads Pipeline', icon: KanbanSquare, perm: 'contacts.view' },
  ] },
  { group: 'Grow', items: [
    { to: '/app/campaigns', label: 'Campaigns', icon: Megaphone, perm: 'campaigns.manage' },
    { to: '/app/templates', label: 'Templates', icon: FileText, perm: 'templates.manage' },
    { to: '/app/commerce', label: 'Catalogue & Payments', icon: ShoppingBag, perm: 'commerce.manage' },
  ] },
  { group: 'Automate', items: [
    { to: '/app/chatbot', label: 'Chatbot', icon: Bot, perm: 'automation.manage' },
    { to: '/app/flows', label: 'Flow Builder', icon: Workflow, perm: 'automation.manage' },
    { to: '/app/follow-ups', label: 'Follow-ups', icon: Repeat, perm: 'automation.manage' },
    { to: '/app/ai', label: 'AI Assistant', icon: Sparkles, perm: 'automation.manage' },
  ] },
  { group: 'Manage', items: [
    { to: '/app/analytics', label: 'Analytics', icon: BarChart3, perm: 'analytics.view' },
    { to: '/app/numbers', label: 'WhatsApp Numbers', icon: Smartphone, perm: 'numbers.manage' },
    { to: '/app/team', label: 'Team & Roles', icon: UserCog },
    { to: '/app/developers', label: 'API & Webhooks', icon: Code2, perm: 'developers.manage' },
    { to: '/app/billing', label: 'Plan & Billing', icon: CreditCard, perm: 'billing.manage' },
    { to: '/app/settings', label: 'Settings', icon: Settings },
  ] },
]

type Notif = { id: number; title: string; body: string; link: string; read_at: string | null; created_at: string }

function Notifications() {
  const [open, setOpen] = useState(false)
  const { data, setData, reload } = useApi<Notif[]>('notifications')
  const nav = useNavigate()
  useEvents((t, d) => { if (t === 'notification') setData((x) => [d as Notif, ...(x ?? [])]) })
  const unread = (data ?? []).filter((n) => !n.read_at).length
  return (
    <div className="relative">
      <button onClick={() => { setOpen(!open); if (!open && unread) void post('notifications/read').then(reload) }} className="relative rounded-xl p-2 text-soft hover:bg-white/5 hover:text-white" aria-label="Notifications">
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-brand text-[9px] font-bold text-ink">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && <>
        <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold text-white">Notifications</div>
          <div className="max-h-96 overflow-y-auto">
            {(data ?? []).length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">You are all caught up.</p>}
            {(data ?? []).map((n) => (
              <button key={n.id} onClick={() => { setOpen(false); if (n.link) nav(n.link) }} className="flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left hover:bg-white/[.03]">
                <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-line-strong' : 'bg-brand')} />
                <span className="min-w-0 flex-1"><span className="block text-sm text-white">{n.title}</span>{n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}</span>
                <span className="text-[11px] text-muted">{ago(n.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      </>}
    </div>
  )
}

function WorkspaceMenu() {
  const { ws, workspaces, switchWorkspace, user, logout } = useSession()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 hover:bg-white/5">
        <Avatar name={user?.name} className="size-8 text-[11px]" />
        <span className="hidden text-left sm:block"><span className="block max-w-40 truncate text-sm font-medium text-white">{ws?.name}</span><span className="block text-[11px] capitalize text-muted">{ws?.role} · {ws?.plan}</span></span>
        <ChevronDown className="size-4 text-muted" />
      </button>
      {open && <>
        <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
        <div className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-2xl border border-line-strong bg-panel p-1.5 shadow-2xl">
          <div className="px-3 py-2"><div className="text-sm font-medium text-white">{user?.name}</div><div className="text-xs text-muted">{user?.email}</div></div>
          <div className="my-1 border-t border-line" />
          <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Workspaces</div>
          {workspaces.map((w) => (
            <button key={w.id} onClick={() => w.id !== ws?.id && switchWorkspace(w.id)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-soft hover:bg-white/5">
              <span className="truncate">{w.name}</span>{w.id === ws?.id && <Check className="size-4 text-brand" />}
            </button>
          ))}
          <Link to="/app/settings?tab=workspaces" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-brand-2 hover:bg-white/5">+ New workspace</Link>
          <div className="my-1 border-t border-line" />
          {user?.is_super_admin ? <Link to="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-soft hover:bg-white/5"><ShieldCheck className="size-4" />MECGURA Admin</Link> : null}
          <a href={BRAND.whatsappHref} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-soft hover:bg-white/5"><LifeBuoy className="size-4" />Support ({BRAND.phone})</a>
          <button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"><LogOut className="size-4" />Sign out</button>
        </div>
      </>}
    </div>
  )
}

function PlanBanner() {
  const { ws, can } = useSession()
  const now = useNow(60000)
  if (!ws) return null
  const end = ws.subscription_status === 'trialing' ? ws.trial_ends_at : ws.current_period_end
  const days = end ? Math.ceil((new Date(end).getTime() - now) / 86400000) : null
  let tone = '', text = ''
  if (ws.status === 'suspended') { tone = 'red'; text = `Workspace suspended. Contact MECGURA at ${BRAND.phone}.` }
  else if (ws.subscription_status === 'expired') { tone = 'red'; text = 'Your plan has expired — outgoing messages are paused. Incoming messages are still saved.' }
  else if (ws.subscription_status === 'cancelled') { tone = 'red'; text = 'Your plan is cancelled — outgoing messages are paused.' }
  else if (ws.subscription_status === 'past_due') { tone = 'amber'; text = 'Your plan period has ended. Renew within 3 days to avoid interruption.' }
  else if (ws.subscription_status === 'trialing' && days !== null && days <= 5) { tone = 'amber'; text = `Free trial ends in ${Math.max(0, days)} day${days === 1 ? '' : 's'}.` }
  if (!text) return null
  return (
    <div className={cx('flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-sm', tone === 'red' ? 'bg-red-500/15 text-red-100' : 'bg-amber-400/15 text-amber-100')}>
      <span>{text}</span>
      {can('billing.manage') ? <Link to="/app/billing" className="font-semibold underline">Choose a plan</Link> : <span className="opacity-80">Ask your workspace owner to renew.</span>}
    </div>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { can, ws } = useSession()
  const [mobile, setMobile] = useState(false)
  const loc = useLocation()
  const fullBleed = loc.pathname.startsWith('/app/inbox') || /\/app\/flows\/\d+/.test(loc.pathname)

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5"><Link to="/app"><Logo className="h-7" /></Link></div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 pt-2">
        {NAV.map((g) => {
          const items = g.items.filter((i) => !i.perm || can(i.perm))
          if (!items.length) return null
          return (
            <div key={g.group}>
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-muted/70">{g.group}</div>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/app'} className={({ isActive }) => cx('group flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition',
                  isActive ? 'bg-brand/10 text-white ring-1 ring-brand/25' : 'text-muted hover:bg-white/[.04] hover:text-white')}>
                  {({ isActive }) => <><i.icon className={cx('size-[18px]', isActive ? 'text-brand-2' : 'text-muted group-hover:text-soft')} />{i.label}</>}
                </NavLink>
              ))}
            </div>
          )
        })}
      </div>
      <div className="m-3 hidden rounded-2xl border border-brand/20 [@media(min-height:980px)]:block bg-gradient-to-br from-brand/10 to-transparent p-3.5 text-xs">
        <div className="font-semibold text-white">Need help going live?</div>
        <p className="mt-1 text-muted">MECGURA onboarding team: {BRAND.phone}</p>
        <a href={`mailto:${BRAND.email}`} className="mt-1 block text-brand-2">{BRAND.email}</a>
      </div>
    </nav>
  )

  return (
    <div className="flex h-svh overflow-hidden">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-panel lg:block">{sidebar}</aside>
      {mobile && <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobile(false)}>
        <aside className="h-full w-72 border-r border-line bg-panel" onClick={(e) => { e.stopPropagation(); if ((e.target as HTMLElement).closest('a')) setMobile(false) }}>{sidebar}</aside>
      </div>}
      <div className="flex min-w-0 flex-1 flex-col">
        {ws?.via_admin && <div className="flex items-center justify-center gap-3 bg-sky-500/15 px-4 py-1.5 text-xs text-sky-100">Viewing {ws.name} as MECGURA admin<Link to="/admin" className="font-semibold underline">Back to admin</Link></div>}
        <PlanBanner />
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-line bg-ink/80 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <button className="rounded-xl p-2 text-soft hover:bg-white/5 lg:hidden" onClick={() => setMobile(true)} aria-label="Menu">{mobile ? <X className="size-5" /> : <Menu className="size-5" />}</button>
            <div className="lg:hidden"><Logo className="h-6" showProduct={false} /></div>
          </div>
          <div className="flex items-center gap-1">
            <Notifications />
            <WorkspaceMenu />
          </div>
        </header>
        <main className={cx('min-h-0 flex-1', fullBleed ? 'overflow-hidden' : 'overflow-y-auto')}>
          {fullBleed ? children : <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>}
        </main>
      </div>
    </div>
  )
}
