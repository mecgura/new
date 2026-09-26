import { useEffect, useState } from 'react'
import { Plus, Smartphone, RefreshCw, Star, Trash2, FlaskConical, KeyRound, BadgeCheck, Copy, Store } from 'lucide-react'
import { get, post, patch, del, api } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Textarea, useToast, statusTone, Confirm } from '../../components/ui'
import { BRAND } from '../../lib/brand'
import type { WaNumber } from '../../lib/types'

type PublicCfg = { embeddedSignup: { appId: string; configId: string; graphVersion: string } | null; webhookUrl: string }
type FB = { init: (o: Record<string, unknown>) => void; login: (cb: (r: { authResponse?: { code?: string } }) => void, o: Record<string, unknown>) => void }
declare global { interface Window { FB?: FB; fbAsyncInit?: () => void } }

function loadFb(appId: string, version: string) {
  return new Promise<FB>((resolve) => {
    if (window.FB) return resolve(window.FB)
    window.fbAsyncInit = () => { window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version }); resolve(window.FB!) }
    const s = document.createElement('script'); s.src = 'https://connect.facebook.net/en_US/sdk.js'; s.async = true; s.crossOrigin = 'anonymous'; document.body.appendChild(s)
  })
}

function ProfileModal({ n, onClose }: { n: WaNumber; onClose: () => void }) {
  const t = useToast()
  const [p, setP] = useState<{ about?: string; description?: string; email?: string; address?: string; websites?: string[] } | null>(null)
  useEffect(() => { get<typeof p>(`numbers/${n.id}/profile`).then(setP).catch((e) => { t.err(e); onClose() }) }, [n.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open onClose={onClose} title="WhatsApp business profile" footer={<Button onClick={async () => { try { await post(`numbers/${n.id}/profile`, { ...p, websites: (p?.websites ?? []).filter(Boolean) }); t.ok('Profile updated on WhatsApp'); onClose() } catch (e) { t.err(e) } }}>Save to WhatsApp</Button>}>
      {!p ? <Loading /> : <div className="space-y-4">
        <Field label="About (139 chars)"><Input maxLength={139} value={p.about ?? ''} onChange={(e) => setP({ ...p, about: e.target.value })} /></Field>
        <Field label="Description"><Textarea rows={3} maxLength={512} value={p.description ?? ''} onChange={(e) => setP({ ...p, description: e.target.value })} /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Email"><Input value={p.email ?? ''} onChange={(e) => setP({ ...p, email: e.target.value })} /></Field><Field label="Website"><Input value={p.websites?.[0] ?? ''} onChange={(e) => setP({ ...p, websites: [e.target.value] })} /></Field></div>
        <Field label="Address"><Input value={p.address ?? ''} onChange={(e) => setP({ ...p, address: e.target.value })} /></Field>
      </div>}
    </Modal>
  )
}

export default function Numbers() {
  const t = useToast()
  const { data, reload } = useApi<WaNumber[]>('numbers')
  const [cfg, setCfg] = useState<PublicCfg | null>(null)
  const { data: ws } = useApi<{ verify_token: string; webhook_url: string }>('workspace')
  const [manual, setManual] = useState(false)
  const [f, setF] = useState({ label: '', phone_number_id: '', waba_id: '', access_token: '' })
  const [busy, setBusy] = useState(false)
  const [delId, setDelId] = useState<number | null>(null)
  const [profile, setProfile] = useState<WaNumber | null>(null)
  useEffect(() => { api<PublicCfg>('/api/public/config').then(setCfg).catch(() => undefined) }, [])

  const embedded = async () => {
    if (!cfg?.embeddedSignup) return
    const es = cfg.embeddedSignup
    const fb = await loadFb(es.appId, es.graphVersion)
    let ids: { phone_number_id?: string; waba_id?: string } = {}
    const onMsg = (e: MessageEvent) => {
      if (!String(e.origin).endsWith('facebook.com')) return
      try { const d = JSON.parse(e.data); if (d.type === 'WA_EMBEDDED_SIGNUP' && d.event === 'FINISH') ids = d.data } catch { /* not ours */ }
    }
    window.addEventListener('message', onMsg)
    fb.login(async (r) => {
      window.removeEventListener('message', onMsg)
      const code = r.authResponse?.code
      if (!code || !ids.phone_number_id) return t.err('Signup was not completed')
      try { await post('numbers/embedded-signup', { code, phone_number_id: ids.phone_number_id, waba_id: ids.waba_id }); t.ok('WhatsApp number connected 🎉'); void reload() } catch (e) { t.err(e) }
    }, { config_id: es.configId, response_type: 'code', override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: '3' } })
  }

  const copy = (v: string) => { void navigator.clipboard.writeText(v); t.ok('Copied') }
  return (
    <>
      <PageHeader title="WhatsApp numbers" subtitle="Connect one or more WhatsApp Business numbers through the official Cloud API." actions={<>
        <Button variant="outline" icon={<FlaskConical className="size-4" />} onClick={async () => { try { await post('numbers/demo'); t.ok('Sandbox number added'); void reload() } catch (e) { t.err(e) } }}>Add sandbox</Button>
        <Button icon={<Plus className="size-4" />} onClick={() => (cfg?.embeddedSignup ? embedded() : setManual(true))}>Connect number</Button>
      </>} />

      {!data ? <Loading /> : data.length === 0 ? (
        <Card><Empty icon={<Smartphone className="size-5" />} title="No numbers connected" text="Start with a sandbox to explore everything, then connect your real number when ready."
          action={<div className="flex gap-2"><Button variant="outline" onClick={async () => { await post('numbers/demo'); void reload() }}>Use sandbox</Button><Button onClick={() => (cfg?.embeddedSignup ? embedded() : setManual(true))}>Connect number</Button></div>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((n) => (
            <Card key={n.id}>
              <div className="flex items-start gap-4">
                <span className="grid size-12 place-items-center rounded-2xl bg-brand/10 text-brand"><Smartphone className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-display font-semibold text-white">{n.verified_name || n.label}</span>{n.is_default ? <Badge tone="green">Default</Badge> : null}{n.is_demo ? <Badge tone="amber">Sandbox</Badge> : null}</div>
                  <div className="mt-0.5 text-sm text-soft">{n.display_phone}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5"><Badge tone={statusTone(n.status)}>{n.status}</Badge>{n.quality_rating && <Badge tone={n.quality_rating === 'GREEN' ? 'green' : n.quality_rating === 'YELLOW' ? 'amber' : 'red'}>Quality: {n.quality_rating.toLowerCase()}</Badge>}{n.messaging_limit && <Badge>{n.messaging_limit.replace('TIER_', 'Limit ')}</Badge>}</div>
                  {!n.is_demo && <div className="mt-2 text-xs text-muted">Phone ID {n.phone_number_id} · WABA {n.waba_id}</div>}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                <input defaultValue={n.label} onBlur={(e) => e.target.value !== n.label && patch(`numbers/${n.id}`, { label: e.target.value }).then(reload)} className="h-8 w-40 rounded-lg border border-line bg-panel px-2 text-xs text-white outline-none" />
                {!n.is_default && <Button size="sm" variant="subtle" icon={<Star className="size-3.5" />} onClick={async () => { await patch(`numbers/${n.id}`, { is_default: true }); void reload() }}>Make default</Button>}
                {!n.is_demo && <Button size="sm" variant="subtle" icon={<RefreshCw className="size-3.5" />} onClick={async () => { try { await post(`numbers/${n.id}/refresh`); t.ok('Refreshed'); void reload() } catch (e) { t.err(e) } }}>Refresh</Button>}
                {!n.is_demo && <Button size="sm" variant="subtle" icon={<Store className="size-3.5" />} onClick={() => setProfile(n)}>Profile</Button>}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDelId(n.id)}><Trash2 className="size-4" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card title="Webhook for your Meta app">
          <p className="mb-3 text-sm text-muted">If you connect with your own Meta app, set this callback in Meta Developers → WhatsApp → Configuration and subscribe to <b className="text-soft">messages</b> and <b className="text-soft">message_template_status_update</b>.</p>
          {[['Callback URL', ws?.webhook_url ?? cfg?.webhookUrl ?? ''], ['Verify token', ws?.verify_token ?? '']].map(([l, v]) => (
            <div key={l} className="mb-2 flex items-center gap-2"><span className="w-28 shrink-0 text-xs text-muted">{l}</span><code className="flex-1 truncate rounded-lg bg-panel px-3 py-2 text-xs text-white">{v}</code><Button size="sm" variant="ghost" onClick={() => copy(v)}><Copy className="size-4" /></Button></div>
          ))}
        </Card>
        <Card title="Need help going live?">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-soft">
            <li>Verify your business in Meta Business Manager</li><li>Use a number not active on the WhatsApp app</li><li>Connect it here and create your first templates</li><li>Request higher messaging limits as quality stays green</li>
          </ol>
          <p className="mt-3 text-sm text-muted">MECGURA team can do it for you: <a className="text-brand-2" href={BRAND.whatsappHref}>{BRAND.phone}</a> · <a className="text-brand-2" href={`mailto:${BRAND.email}`}>{BRAND.email}</a></p>
        </Card>
      </div>

      <Modal open={manual} onClose={() => setManual(false)} title="Connect with Cloud API credentials" wide footer={<><Button variant="ghost" onClick={() => setManual(false)}>Cancel</Button><Button loading={busy} onClick={async () => {
        setBusy(true)
        try { await post('numbers', f); t.ok('Number connected'); setManual(false); setF({ label: '', phone_number_id: '', waba_id: '', access_token: '' }); void reload() } catch (e) { t.err(e) } finally { setBusy(false) }
      }}>Verify & connect</Button></>}>
        <div className="mb-4 flex gap-3 rounded-xl border border-line bg-panel p-3 text-sm text-muted"><BadgeCheck className="size-5 shrink-0 text-sky-400" /><span>From <b className="text-soft">Meta Developers → your app → WhatsApp → API Setup</b>. Use a permanent <b className="text-soft">System User access token</b> with whatsapp_business_messaging and whatsapp_business_management permissions.</span></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Label"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Main / Sales / Branch 2" /></Field>
          <Field label="Phone number ID"><Input value={f.phone_number_id} onChange={(e) => setF({ ...f, phone_number_id: e.target.value.trim() })} /></Field>
          <Field label="WhatsApp Business Account ID"><Input value={f.waba_id} onChange={(e) => setF({ ...f, waba_id: e.target.value.trim() })} /></Field>
          <Field label="Access token" className="sm:col-span-2"><div className="relative"><KeyRound className="absolute left-3 top-3 size-4 text-muted" /><Input className="pl-9" type="password" value={f.access_token} onChange={(e) => setF({ ...f, access_token: e.target.value.trim() })} /></div></Field>
        </div>
        <p className="mt-3 text-xs text-muted">Tokens are encrypted at rest and never shown again.</p>
      </Modal>
      {profile && <ProfileModal n={profile} onClose={() => setProfile(null)} />}
      <Confirm open={!!delId} onClose={() => setDelId(null)} title="Disconnect number?" text="Conversations stay in your inbox, but you will not be able to send or receive messages on this number here." confirmLabel="Disconnect" onConfirm={async () => { await del(`numbers/${delId}`); void reload() }} />
    </>
  )
}
