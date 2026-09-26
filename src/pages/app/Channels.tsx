import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Copy, Trash2, Settings2, ExternalLink, CheckCircle2, AlertTriangle, KeyRound, Eye } from 'lucide-react'
import { post, patch, del } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { num } from '../../lib/format'
import { Badge, Button, Card, Confirm, Field, Input, Loading, Modal, PageHeader, Select, Textarea, Toggle, useToast, cx } from '../../components/ui'
import { ChannelGlyph } from '../../components/ChannelIcon'
import { CHANNELS } from '../../lib/channels'
import type { WaNumber } from '../../lib/types'

type WebCfg = { title: string; subtitle: string; greeting: string; color: string; position: 'right' | 'left'; whatsapp: string; ask_details: boolean; launcher_text: string }
type Ch = { id: number; type: 'web' | 'messenger' | 'instagram' | 'api'; name: string; external_id: string | null; public_key: string | null; is_active: number; connected: boolean
  config: Partial<WebCfg> & { page_name?: string; subscribed?: boolean }; embed?: string; stats: { open: number; total: number }; created_at: string }
type Data = { channels: Ch[]; meta_webhook: { url: string; verify_token: string; app_configured: boolean }; api: { inbound_url: string } }

const INFO: Record<string, { title: string; text: string; cta: string }> = {
  web: { title: 'Website chat', text: 'A chat bubble for any website — WordPress, Shopify, Wix or custom HTML. One line of code.', cta: 'Set up' },
  instagram: { title: 'Instagram DMs', text: 'Reply to Instagram direct messages from the Team Inbox, with the same bots and flows.', cta: 'Connect' },
  messenger: { title: 'Facebook Messenger', text: 'Messages to your Facebook Page arrive in the inbox and get instant bot replies.', cta: 'Connect' },
  api: { title: 'Custom / API', text: 'Connect your own app, CRM or website backend. Send chats in, get bot and agent replies back.', cta: 'View setup' },
}

function copy(t: ReturnType<typeof useToast>, text: string, what = 'Copied') { void navigator.clipboard.writeText(text); t.ok(what) }

export default function Channels() {
  const t = useToast()
  const { data, reload } = useApi<Data>('channels')
  const { data: numbers } = useApi<WaNumber[]>('numbers')
  const [web, setWeb] = useState<Ch | 'new' | null>(null)
  const [meta, setMeta] = useState<'messenger' | 'instagram' | null>(null)
  const [api, setApi] = useState(false)
  const [rm, setRm] = useState<Ch | null>(null)
  if (!data) return <Loading />
  const open = (type: string) => type === 'web' ? setWeb('new') : type === 'api' ? setApi(true) : setMeta(type as 'messenger' | 'instagram')
  return (
    <>
      <PageHeader title="Channels" subtitle="Every place your customers message you — WhatsApp, your website, Instagram, Facebook and your own apps — lands in one Team Inbox with the same chatbots, flows, AI and agents." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <span className={cx('grid size-10 place-items-center rounded-xl', CHANNELS.whatsapp.color)}><ChannelGlyph channel="whatsapp" className="size-5" /></span>
          <div className="mt-3 font-semibold text-white">WhatsApp</div>
          <p className="mt-1 text-sm text-muted">{numbers?.length ? `${numbers.length} number${numbers.length > 1 ? 's' : ''} connected` : 'Official WhatsApp Cloud API.'}</p>
          <Link to="/app/numbers"><Button className="mt-4" size="sm" variant="subtle">Manage numbers</Button></Link>
        </Card>
        {(['web', 'instagram', 'messenger', 'api'] as const).map((k) => (
          <Card key={k}>
            <span className={cx('grid size-10 place-items-center rounded-xl', CHANNELS[k].color)}><ChannelGlyph channel={k} className="size-5" /></span>
            <div className="mt-3 font-semibold text-white">{INFO[k].title}</div>
            <p className="mt-1 text-sm text-muted">{INFO[k].text}</p>
            <Button className="mt-4" size="sm" icon={k === 'api' ? undefined : <Plus className="size-3.5" />} variant={k === 'api' ? 'subtle' : 'primary'} onClick={() => open(k)}>{INFO[k].cta}</Button>
          </Card>
        ))}
      </div>

      <Card className="mt-6" title="Connected channels" pad={false}>
        {data.channels.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted">No extra channels yet. Add website chat to start — it takes a minute.</p> : (
          <div className="divide-y divide-line">
            {data.channels.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <span className={cx('grid size-9 shrink-0 place-items-center rounded-xl', CHANNELS[c.type].color)}><ChannelGlyph channel={c.type} className="size-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-white">{c.name}</div>
                  <div className="text-xs text-muted">{CHANNELS[c.type].label}{c.config.page_name ? ` · Page: ${c.config.page_name}` : ''} · {num(c.stats.total)} chats · {num(c.stats.open)} open</div>
                </div>
                {(c.type === 'messenger' || c.type === 'instagram') && (c.config.subscribed ? <Badge tone="green">Receiving messages</Badge> : <Badge tone="amber">Check webhook setup</Badge>)}
                <Toggle checked={!!c.is_active} onChange={async (v) => { try { await patch(`channels/${c.id}`, { is_active: v }); void reload() } catch (e) { t.err(e) } }} label={c.is_active ? 'On' : 'Off'} />
                {c.type === 'web' && <Button size="sm" variant="subtle" icon={<Settings2 className="size-3.5" />} onClick={() => setWeb(c)}>Customise & code</Button>}
                {c.type === 'api' && <Button size="sm" variant="subtle" onClick={() => setApi(true)}>Setup</Button>}
                <button className="text-muted hover:text-red-300" onClick={() => setRm(c)} title="Remove channel"><Trash2 className="size-4" /></button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {web && <WebModal ch={web === 'new' ? null : web} onClose={() => setWeb(null)} onSaved={(c) => { setWeb(c); void reload() }} />}
      {meta && <MetaModal type={meta} hook={data.meta_webhook} onClose={() => setMeta(null)} onSaved={() => { setMeta(null); void reload() }} />}
      {api && <ApiModal url={data.api.inbound_url} onClose={() => setApi(false)} />}
      <Confirm open={!!rm} onClose={() => setRm(null)} title={`Remove ${rm?.name}?`} text="New messages from this channel stop arriving. Existing chats stay in the inbox as history." confirmLabel="Remove"
        onConfirm={async () => { await del(`channels/${rm!.id}`); void reload() }} />
    </>
  )
}

const DEFAULT_WEB: WebCfg = { title: 'Chat with us', subtitle: 'We usually reply in a few minutes', greeting: 'Hi 👋 How can we help you today?', color: '#10b981', position: 'right', whatsapp: '', ask_details: true, launcher_text: '' }

function WebModal({ ch, onClose, onSaved }: { ch: Ch | null; onClose: () => void; onSaved: (c: Ch) => void }) {
  const t = useToast()
  const [name, setName] = useState(ch?.name ?? 'Website chat')
  const [c, setC] = useState<WebCfg>({ ...DEFAULT_WEB, ...(ch?.config ?? {}) })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const r = ch ? await patch<Ch>(`channels/${ch.id}`, { name, config: c }) : await post<Ch>('channels', { type: 'web', name, config: c })
      t.ok(ch ? 'Saved — changes show on the website within a few minutes' : 'Website chat created. Copy the code below.')
      onSaved({ ...r, stats: ch?.stats ?? { open: 0, total: 0 } })
    } catch (e) { t.err(e) } finally { setBusy(false) }
  }
  const demo = ch?.public_key && ch.embed ? `${new URL(ch.embed.match(/src="([^"]+)"/)![1]).origin}/widget/${ch.public_key}/demo` : null
  return (
    <Modal open onClose={onClose} wide="xl" title={ch ? `Website chat — ${ch.name}` : 'Add website chat'} footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button loading={busy} onClick={save}>{ch ? 'Save changes' : 'Create chat widget'}</Button></>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {ch?.embed && <div className="rounded-2xl border border-brand/30 bg-brand/5 p-4">
            <div className="text-sm font-semibold text-white">1. Paste this before &lt;/body&gt; on every page of the website</div>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-ink p-3 text-xs text-brand-2">{ch.embed}</pre>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" icon={<Copy className="size-3.5" />} onClick={() => copy(t, ch.embed!, 'Code copied')}>Copy code</Button>
              {demo && <a href={demo} target="_blank" rel="noreferrer"><Button size="sm" variant="subtle" icon={<Eye className="size-3.5" />}>Open live preview</Button></a>}
            </div>
            <p className="mt-2 text-xs text-muted">WordPress: Appearance → Theme File Editor → footer.php, or any “Insert Headers and Footers” plugin. Shopify: Online Store → Themes → Edit code → theme.liquid. Wix: Settings → Custom code.</p>
          </div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Internal name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Brand colour"><div className="flex gap-2"><input type="color" value={c.color} onChange={(e) => setC({ ...c, color: e.target.value })} className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-transparent" /><Input value={c.color} onChange={(e) => setC({ ...c, color: e.target.value })} /></div></Field>
            <Field label="Header title"><Input value={c.title} maxLength={40} onChange={(e) => setC({ ...c, title: e.target.value })} /></Field>
            <Field label="Header subtitle"><Input value={c.subtitle} maxLength={80} onChange={(e) => setC({ ...c, subtitle: e.target.value })} /></Field>
          </div>
          <Field label="Greeting message"><Textarea rows={2} value={c.greeting} maxLength={300} onChange={(e) => setC({ ...c, greeting: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Position"><Select value={c.position} onChange={(e) => setC({ ...c, position: e.target.value as WebCfg['position'] })}><option value="right">Bottom right</option><option value="left">Bottom left</option></Select></Field>
            <Field label="Button text (optional)"><Input value={c.launcher_text} maxLength={30} placeholder="Chat with us" onChange={(e) => setC({ ...c, launcher_text: e.target.value })} /></Field>
            <Field label="WhatsApp button (number)" hint="Adds “Continue on WhatsApp”"><Input value={c.whatsapp} placeholder="919876543210" onChange={(e) => setC({ ...c, whatsapp: e.target.value })} /></Field>
          </div>
          <Toggle checked={c.ask_details} onChange={(ask_details) => setC({ ...c, ask_details })} label="Ask name & phone before the chat starts (saves them as a lead)" />
        </div>
        <WidgetPreview c={c} />
      </div>
    </Modal>
  )
}

function WidgetPreview({ c }: { c: WebCfg }) {
  return (
    <div className="rounded-2xl border border-line bg-[#e9edf0] p-3">
      <div className="text-center text-[11px] font-medium text-slate-500">Preview</div>
      <div className="mt-2 overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="p-4 text-white" style={{ background: c.color }}>
          <div className="text-[15px] font-bold">{c.title || 'Chat with us'}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs opacity-90"><span className="size-2 rounded-full bg-emerald-200" />{c.subtitle}</div>
        </div>
        <div className="space-y-2 bg-[#f5f7f6] p-3">
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800">{c.greeting}</div>
          <div className="ml-auto max-w-[75%] rounded-2xl rounded-br-sm px-3 py-2 text-[13px] text-white" style={{ background: c.color }}>What are your prices?</div>
          <div className="flex flex-wrap gap-1.5">{['Pricing', 'Book a demo'].map((b) => <span key={b} className="rounded-full border bg-white px-2.5 py-1 text-xs font-semibold" style={{ borderColor: c.color, color: c.color }}>{b}</span>)}</div>
        </div>
        <div className="flex gap-2 border-t border-slate-100 p-2.5"><div className="h-9 flex-1 rounded-xl border border-slate-200" /><div className="size-9 rounded-xl" style={{ background: c.color }} /></div>
        {c.whatsapp && <div className="mx-2.5 mb-2.5 rounded-xl bg-[#25D366] py-2 text-center text-xs font-bold text-white">Continue on WhatsApp</div>}
      </div>
      <div className={cx('mt-3 flex', c.position === 'left' ? 'justify-start' : 'justify-end')}>
        <div className="flex h-12 items-center gap-2 rounded-full px-4 text-sm font-semibold text-white shadow-lg" style={{ background: c.color }}>💬{c.launcher_text && <span>{c.launcher_text}</span>}</div>
      </div>
    </div>
  )
}

function MetaModal({ type, hook, onClose, onSaved }: { type: 'messenger' | 'instagram'; hook: Data['meta_webhook']; onClose: () => void; onSaved: () => void }) {
  const t = useToast()
  const [f, setF] = useState({ page_id: '', page_token: '', name: '' })
  const [busy, setBusy] = useState(false)
  const ig = type === 'instagram'
  return (
    <Modal open onClose={onClose} wide title={ig ? 'Connect Instagram DMs' : 'Connect Facebook Messenger'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button loading={busy} disabled={!f.page_id || f.page_token.length < 20} onClick={async () => {
        setBusy(true)
        try { await post('channels', { type, ...f, name: f.name || undefined }); t.ok(`${ig ? 'Instagram' : 'Messenger'} connected`); onSaved() } catch (e) { t.err(e) } finally { setBusy(false) }
      }}>Connect</Button></>}>
      <div className="space-y-4">
        {!hook.app_configured && <div className="flex gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100"><AlertTriangle className="mt-0.5 size-4 shrink-0" />META_APP_SECRET is not set on the server yet. Ask MECGURA to finish the Meta app setup first.</div>}
        <ol className="space-y-3 text-sm text-soft">
          <li><b className="text-white">1.</b> {ig ? 'Your Instagram must be a Professional (Business/Creator) account linked to a Facebook Page (Meta Business Suite → Settings → Instagram accounts). In Instagram app → Settings → Messages → allow access to messages.' : 'You need admin access to the Facebook Page.'}</li>
          <li><b className="text-white">2.</b> In the Meta developer app (the same app used for WhatsApp) add the <b>{ig ? 'Instagram' : 'Messenger'}</b> product and set the webhook:
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="flex gap-2"><Input readOnly value={hook.url} /><Button variant="subtle" onClick={() => copy(t, hook.url)}><Copy className="size-4" /></Button></div>
              <div className="flex gap-2"><Input readOnly value={hook.verify_token} /><Button variant="subtle" onClick={() => copy(t, hook.verify_token)}><Copy className="size-4" /></Button></div>
            </div>
            <span className="mt-1 block text-xs text-muted">Subscribe to: <code>messages</code>, <code>messaging_postbacks</code>.</span></li>
          <li><b className="text-white">3.</b> Messenger → Settings → Access Tokens → add your Page → <b>Generate token</b>. Paste the Page ID and token here. We subscribe the Page automatically.</li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Facebook Page ID"><Input value={f.page_id} onChange={(e) => setF({ ...f, page_id: e.target.value.trim() })} placeholder="1029384756…" /></Field>
          <Field label="Display name (optional)"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={ig ? '@yourbrand' : 'Your Page'} /></Field>
        </div>
        <Field label="Page access token" hint="Stored encrypted. Use a long-lived token so it does not expire."><Textarea rows={3} value={f.page_token} onChange={(e) => setF({ ...f, page_token: e.target.value.trim() })} placeholder="EAAG…" /></Field>
        <p className="flex items-center gap-1.5 text-xs text-muted"><CheckCircle2 className="size-3.5 text-brand" />Replies must be sent within 24 hours of the customer’s last message (Meta rule).</p>
      </div>
    </Modal>
  )
}

function ApiModal({ url, onClose }: { url: string; onClose: () => void }) {
  const t = useToast()
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"user_id":"customer-42","name":"Aman","text":"Hi, is this in stock?","channel":"My App"}'`
  return (
    <Modal open onClose={onClose} wide title="Connect your own system" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="space-y-4 text-sm text-soft">
        <p>Use this when a client has their own website backend, mobile app or CRM chat. Every message you send in appears in the Team Inbox and gets the <b className="text-white">same answers</b> as WhatsApp — chatbot, flows, AI and agents.</p>
        <div><div className="mb-1 font-medium text-white">1. Send customer messages in</div>
          <pre className="overflow-x-auto rounded-xl bg-ink p-3 text-xs text-brand-2">{curl}</pre>
          <Button className="mt-2" size="sm" variant="subtle" icon={<Copy className="size-3.5" />} onClick={() => copy(t, curl)}>Copy example</Button></div>
        <div><div className="mb-1 font-medium text-white">2. Show the replies</div>
          <p>Instant bot replies come back in the response (<code>replies</code>). Agent replies are pushed to your webhook as <code>message.sent</code> with <code>channel: "api"</code>, or poll <code>GET /api/v1/conversations/:id/messages?after=ID</code>.</p></div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/developers"><Button size="sm" icon={<KeyRound className="size-3.5" />}>Create API key & webhook</Button></Link>
          <a href={url.replace('/api/v1/inbound', '/health')} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />}>API status</Button></a>
        </div>
      </div>
    </Modal>
  )
}
