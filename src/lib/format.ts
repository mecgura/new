export const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`
export const num = (n: number) => (n || 0).toLocaleString('en-IN')
export const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
export const limitLabel = (n: number) => (n < 0 ? 'Unlimited' : num(n))

export function ago(iso?: string | null) {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 604800) return `${Math.floor(s / 86400)}d`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
export const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—')
export const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
export const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '')
export const phone = (wa?: string | null) => (wa ? `+${wa}` : '')
export const initials = (s?: string | null) => (s || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
export const titleCase = (s: string) => s.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
