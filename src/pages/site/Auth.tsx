import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import Logo from '../../components/Logo'
import { Button, Field, Input, Select, useToast } from '../../components/ui'
import { api } from '../../lib/api'
import { useSession, type User, type Workspace } from '../../lib/session'
import { BRAND } from '../../lib/brand'

type Session = { token: string; user: User; workspaces: Workspace[] }

function AuthFrame({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-5 py-8 sm:px-12">
        <Link to="/"><Logo className="h-8" /></Link>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-3xl font-bold text-white">{title}</h1>
          <p className="mt-2 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
        <p className="text-xs text-muted">Need help? {BRAND.email} · {BRAND.phone}</p>
      </div>
      <div className="relative hidden overflow-hidden border-l border-line bg-panel lg:block">
        <div className="grid-bg absolute inset-0 opacity-60" /><div className="glow absolute inset-0" />
        <div className="relative flex h-full flex-col justify-center px-16">
          <h2 className="font-display text-4xl font-bold leading-tight text-white">Your customers are on WhatsApp.<br /><span className="text-gradient">Your business should be too.</span></h2>
          <ul className="mt-8 space-y-3 text-soft">
            {['Shared team inbox with assignment & notes', 'Bulk campaigns with delivery & read tracking', 'No-code chatbots, flows and AI replies', 'CRM pipeline, catalogue and payment links'].map((t) => <li key={t} className="flex gap-3"><CheckCircle2 className="size-5 text-brand" />{t}</li>)}
          </ul>
        </div>
      </div>
    </div>
  )
}

export function Login() {
  const { setSession } = useSession()
  const nav = useNavigate()
  const t = useToast()
  const [f, setF] = useState({ email: '', password: '' })
  const [busy, setBusy] = useState(false)
  return (
    <AuthFrame title="Welcome back" subtitle={<>New to MECGURA WhatsApp? <Link to="/signup" className="text-brand-2">Start your free trial</Link></>}>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true)
        try { setSession(await api<Session>('/api/auth/login', { body: f })); nav('/app') } catch (err) { t.err(err) } finally { setBusy(false) }
      }}>
        <Field label="Email"><Input type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password"><Input type="password" required autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Button className="w-full" size="lg" loading={busy}>Sign in</Button>
        <p className="text-center text-xs text-muted">Forgot your password? Email {BRAND.email} from your registered address.</p>
      </form>
    </AuthFrame>
  )
}

export function Signup() {
  const { setSession } = useSession()
  const nav = useNavigate()
  const t = useToast()
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', company: '', industry: '' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  return (
    <AuthFrame title="Start your 14-day free trial" subtitle={<>Already have an account? <Link to="/login" className="text-brand-2">Sign in</Link></>}>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true)
        try { setSession(await api<Session>('/api/auth/signup', { body: f })); nav('/app?welcome=1') } catch (err) { t.err(err) } finally { setBusy(false) }
      }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name"><Input required value={f.name} onChange={set('name')} /></Field>
          <Field label="Mobile"><Input value={f.phone} onChange={set('phone')} placeholder="+91" /></Field>
        </div>
        <Field label="Work email"><Input type="email" required value={f.email} onChange={set('email')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name"><Input required value={f.company} onChange={set('company')} /></Field>
          <Field label="Industry"><Select value={f.industry} onChange={set('industry')}>
            <option value="">Select…</option>{['Retail / D2C', 'Education', 'Real estate', 'Healthcare', 'Travel', 'Restaurants', 'Services', 'Agency', 'Other'].map((i) => <option key={i}>{i}</option>)}
          </Select></Field>
        </div>
        <Field label="Password" hint="At least 8 characters"><Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
        <Button className="w-full" size="lg" loading={busy}>Create workspace</Button>
        <p className="text-center text-xs text-muted">By signing up you agree to our <Link to="/terms" className="underline">Terms</Link> and <Link to="/privacy" className="underline">Privacy Policy</Link>.</p>
      </form>
    </AuthFrame>
  )
}

export function AcceptInvite() {
  const { token } = useParams()
  const { setSession } = useSession()
  const nav = useNavigate()
  const t = useToast()
  const [inv, setInv] = useState<{ email: string; role: string; workspace: string; has_account: boolean } | null>(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState({ name: '', password: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<typeof inv>(`/api/auth/invites/${token}`).then(setInv).catch((e) => setErr(e.message)) }, [token])
  return (
    <AuthFrame title={inv ? `Join ${inv.workspace}` : 'Team invite'} subtitle={inv ? <>You were invited as <b className="capitalize text-white">{inv.role}</b> ({inv.email})</> : err || 'Loading…'}>
      {inv && <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true)
        try { setSession(await api<Session>(`/api/auth/invites/${token}/accept`, { body: f })); nav('/app') } catch (er) { t.err(er) } finally { setBusy(false) }
      }}>
        {!inv.has_account && <Field label="Your name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>}
        <Field label={inv.has_account ? 'Your existing password' : 'Create password'}><Input type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <Button className="w-full" size="lg" loading={busy}>Accept invite</Button>
      </form>}
    </AuthFrame>
  )
}
