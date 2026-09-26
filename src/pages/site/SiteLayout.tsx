import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X, Mail, Phone, Globe } from 'lucide-react'
import Logo from '../../components/Logo'
import { BRAND } from '../../lib/brand'
import { useSession } from '../../lib/session'

const links = [['Features', '/#features'], ['Solutions', '/#solutions'], ['Pricing', '/#pricing'], ['Developers', '/docs'], ['Contact', '/#contact']]

export function SiteNav() {
  const [open, setOpen] = useState(false)
  const { user } = useSession()
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/5 bg-ink/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="MECGURA WhatsApp home"><Logo className="h-7" /></Link>
        <nav className="hidden items-center gap-7 md:flex">
          {links.map(([l, h]) => <a key={l} href={h} className="text-sm text-soft transition hover:text-white">{l}</a>)}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {user ? <Link to="/app" className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-ink hover:bg-brand-2">Open dashboard</Link> : <>
            <Link to="/login" className="rounded-xl px-4 py-2 text-sm font-medium text-soft hover:text-white">Sign in</Link>
            <Link to="/signup" className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-ink shadow-[0_6px_24px_-8px_rgba(16,185,129,.8)] hover:bg-brand-2">Start free trial</Link>
          </>}
        </div>
        <button className="rounded-lg p-2 text-soft md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">{open ? <X /> : <Menu />}</button>
      </div>
      {open && (
        <div className="border-t border-line bg-ink px-4 pb-5 pt-2 md:hidden">
          {links.map(([l, h]) => <a key={l} href={h} onClick={() => setOpen(false)} className="block py-2.5 text-soft">{l}</a>)}
          <div className="mt-3 flex gap-2">
            <Link to="/login" className="flex-1 rounded-xl border border-line-strong py-2.5 text-center text-sm text-white">Sign in</Link>
            <Link to="/signup" className="flex-1 rounded-xl bg-brand py-2.5 text-center text-sm font-semibold text-ink">Start free trial</Link>
          </div>
        </div>
      )}
    </header>
  )
}

export function SiteFooter() {
  const cols: [string, [string, string][]][] = [
    ['Product', [['Team Inbox', '/#features'], ['Campaigns', '/#features'], ['Flow Builder', '/#features'], ['AI Assistant', '/#features'], ['Pricing', '/#pricing']]],
    ['Developers', [['API documentation', '/docs'], ['Webhooks', '/docs#webhooks'], ['Status', '/health']]],
    ['Company', [['Contact', '/#contact'], ['Terms of Service', '/terms'], ['Privacy Policy', '/privacy'], ['mecgura.tech', BRAND.website]]],
  ]
  return (
    <footer className="border-t border-line bg-panel">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo className="h-8" />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">WhatsApp Business API platform for Indian businesses — inbox, campaigns, chatbots, AI and payments in one place.</p>
          <div className="mt-5 space-y-2 text-sm">
            <a href={`mailto:${BRAND.email}`} className="flex items-center gap-2 text-soft hover:text-white"><Mail className="size-4 text-brand" />{BRAND.email}</a>
            <a href={BRAND.phoneHref} className="flex items-center gap-2 text-soft hover:text-white"><Phone className="size-4 text-brand" />{BRAND.phone}</a>
            <a href={BRAND.website} className="flex items-center gap-2 text-soft hover:text-white"><Globe className="size-4 text-brand" />{BRAND.websiteLabel}</a>
          </div>
        </div>
        {cols.map(([t, items]) => (
          <div key={t}>
            <div className="text-xs font-semibold uppercase tracking-wider text-white">{t}</div>
            <ul className="mt-4 space-y-2.5">{items.map(([l, h]) => <li key={l}><a href={h} className="text-sm text-muted hover:text-white">{l}</a></li>)}</ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:px-6 md:flex-row md:items-center md:justify-between">
          <span>© {new Date().getFullYear()} MECGURA — All Rights Reserved</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span>Email: <a className="text-soft hover:text-white" href={`mailto:${BRAND.email}`}>{BRAND.email}</a></span>
            <span>Phone: <a className="text-soft hover:text-white" href={BRAND.phoneHref}>{BRAND.phone}</a></span>
            <span>Website: <a className="text-soft hover:text-white" href={BRAND.website}>{BRAND.websiteLabel}</a></span>
          </span>
        </div>
        <p className="mx-auto max-w-7xl px-4 pb-6 text-[11px] text-muted/70 sm:px-6">WhatsApp is a trademark of WhatsApp LLC. MECGURA WhatsApp uses the official WhatsApp Business Platform (Cloud API) provided by Meta.</p>
      </div>
    </footer>
  )
}

export default function SiteLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-svh overflow-x-hidden"><SiteNav /><main className="pt-16">{children}</main><SiteFooter /></div>
}
