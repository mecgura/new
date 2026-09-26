/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { X, Loader2, CheckCircle2, AlertCircle, Inbox } from 'lucide-react'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
export { cx }

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'outline' | 'danger' | 'subtle'; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }
export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...p }: BtnProps) {
  const v = {
    primary: 'bg-brand text-ink hover:bg-brand-2 shadow-[0_6px_24px_-8px_rgba(16,185,129,.7)]',
    outline: 'border border-line-strong text-soft hover:border-brand/50 hover:text-white bg-transparent',
    ghost: 'text-soft hover:bg-white/5 hover:text-white',
    subtle: 'bg-raised text-soft hover:bg-line hover:text-white border border-line',
    danger: 'bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20',
  }[variant]
  const s = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-[15px] gap-2' }[size]
  return (
    <button className={cx('inline-flex shrink-0 items-center justify-center rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50', v, s, className)} disabled={disabled || loading} {...p}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

const field = 'rounded-xl border border-line bg-panel px-3.5 text-sm text-white placeholder:text-muted/70 outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/15'
const wFull = (c?: string) => (c && /(^|\s)(max-)?w-/.test(c) ? '' : 'w-full')
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cx(field, wFull(className), 'h-10', className)} {...p} />
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cx(field, 'w-full py-2.5 leading-relaxed', className)} rows={4} {...p} />
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cx(field, wFull(className), 'h-10 pr-8', className)} {...p}>{children}</select>

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium text-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Card({ className, children, title, action, pad = true }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; pad?: boolean }) {
  return (
    <div className={cx('rounded-2xl border border-line bg-card', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h3 className="font-display text-sm font-semibold text-white">{title}</h3>
          {action}
        </div>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </div>
  )
}

const tones: Record<string, string> = {
  green: 'bg-brand/12 text-brand-2 border-brand/25', gray: 'bg-white/5 text-soft border-line-strong', amber: 'bg-amber-400/10 text-amber-300 border-amber-400/25',
  red: 'bg-red-500/10 text-red-300 border-red-500/25', blue: 'bg-sky-400/10 text-sky-300 border-sky-400/25', violet: 'bg-violet-400/10 text-violet-300 border-violet-400/25',
}
export function Badge({ tone = 'gray', children, className }: { tone?: keyof typeof tones | string; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium', tones[tone] ?? tones.gray, className)}>{children}</span>
}

export const statusTone = (s: string) => ({
  APPROVED: 'green', active: 'green', completed: 'green', paid: 'green', delivered: 'green', read: 'blue', connected: 'green', open: 'green', won: 'green', sent: 'gray',
  PENDING: 'amber', pending: 'amber', scheduled: 'blue', running: 'blue', trialing: 'blue', draft: 'gray', created: 'amber', queued: 'gray', waiting: 'amber',
  REJECTED: 'red', failed: 'red', suspended: 'red', cancelled: 'gray', lost: 'red', error: 'red', paused: 'amber', resolved: 'gray', PAUSED: 'amber', DISABLED: 'red',
} as Record<string, string>)[s] ?? 'gray'

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean | 'xl' }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className={cx('rise flex max-h-[92svh] w-full flex-col rounded-t-2xl border border-line-strong bg-panel shadow-2xl sm:rounded-2xl', wide === 'xl' ? 'sm:max-w-5xl' : wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-display text-base font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-white/5 hover:text-white" aria-label="Close"><X className="size-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  )
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="flex h-full w-full max-w-xl flex-col border-l border-line-strong bg-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-display font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-white/5 hover:text-white" aria-label="Close"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex cursor-pointer items-center gap-2.5 text-sm text-soft', disabled && 'opacity-50')}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 rounded-full transition', checked ? 'bg-brand' : 'bg-line-strong')}>
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {label}
    </label>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-1">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={cx('whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition', value === t.id ? 'bg-raised text-white shadow' : 'text-muted hover:text-white')}>{t.label}</button>
      ))}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center justify-between text-xs text-muted"><span>{label}</span>{icon && <span className="text-brand">{icon}</span>}</div>
      <div className="mt-2 font-display text-2xl font-bold text-white">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  )
}

export function Empty({ title, text, action, icon }: { title: string; text?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-line bg-raised text-brand">{icon ?? <Inbox className="size-5" />}</div>
      <h3 className="font-display font-semibold text-white">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cx('size-5 animate-spin text-brand', className)} />
export const Loading = () => <div className="grid place-items-center py-20"><Spinner /></div>

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">{head.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  )
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx('px-4 py-3 align-middle text-soft', className)}>{children}</td>

export function Progress({ value, max }: { value: number; max: number }) {
  const p = max < 0 ? 4 : Math.min(100, max ? (value / max) * 100 : 0)
  return <div className="h-1.5 overflow-hidden rounded-full bg-line"><div className={cx('h-full rounded-full', p > 90 ? 'bg-red-400' : p > 70 ? 'bg-amber-400' : 'bg-brand')} style={{ width: `${p}%` }} /></div>
}

// ---- Toasts ----
type Toast = { id: number; kind: 'ok' | 'err'; text: string }
const ToastCtx = createContext<(kind: 'ok' | 'err', text: string) => void>(() => undefined)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((kind: 'ok' | 'err', text: string) => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, kind, text }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'err' ? 6000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={cx('rise pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur', t.kind === 'ok' ? 'border-brand/30 bg-panel/95 text-white' : 'border-red-500/30 bg-panel/95 text-red-200')}>
            {t.kind === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" /> : <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-400" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export function useToast() {
  const push = useContext(ToastCtx)
  return { ok: (t: string) => push('ok', t), err: (e: unknown) => push('err', e instanceof Error ? e.message : String(e)) }
}

export function Avatar({ name, className }: { name?: string | null; className?: string }) {
  const s = (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const hue = [...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 5
  const bg = ['from-emerald-500/30 to-emerald-700/30', 'from-teal-500/30 to-cyan-700/30', 'from-lime-500/25 to-emerald-700/30', 'from-sky-500/25 to-teal-700/30', 'from-green-500/30 to-teal-800/30'][hue]
  return <span className={cx('grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-semibold text-white ring-1 ring-white/10', bg, className ?? 'size-9 text-xs')}>{s}</span>
}

export function Confirm({ open, title, text, onConfirm, onClose, danger = true, confirmLabel = 'Confirm' }: { open: boolean; title: string; text: ReactNode; onConfirm: () => Promise<void> | void; onClose: () => void; danger?: boolean; confirmLabel?: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} onClose={onClose} title={title} footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose() } finally { setBusy(false) } }}>{confirmLabel}</Button>
    </>}>
      <p className="text-sm text-soft">{text}</p>
    </Modal>
  )
}

export function TagInput({ value, onChange, placeholder = 'Add tag…', suggestions = [] }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [t, setT] = useState('')
  const add = (s: string) => { const v = s.trim(); if (v && !value.includes(v)) onChange([...value, v]); setT('') }
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-panel px-2 py-1.5 focus-within:border-brand/60">
      {value.map((v) => <Badge key={v} tone="green">{v}<button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="hover:text-white"><X className="size-3" /></button></Badge>)}
      <input list="tag-suggest" value={t} onChange={(e) => setT(e.target.value)} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(t) } else if (e.key === 'Backspace' && !t && value.length) onChange(value.slice(0, -1)) }}
        onBlur={() => t && add(t)} className="min-w-24 flex-1 bg-transparent px-1 text-sm text-white outline-none placeholder:text-muted/70" />
      <datalist id="tag-suggest">{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  )
}
