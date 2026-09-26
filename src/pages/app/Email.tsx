import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Mail, Send, Trash2, Pencil, Code2, Eye, Users, Tag, KanbanSquare, AlertTriangle } from 'lucide-react'
import { post, put, del } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { num, pct, dateTime, titleCase } from '../../lib/format'
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, Tabs, TagInput, useToast, statusTone, Confirm, Drawer, cx } from '../../components/ui'

type Tpl = { id: number; name: string; subject: string; html: string; updated_at: string }
type Camp = { id: number; name: string; status: string; template_name: string; total: number; sent: number; failed: number; opened: number; unsubscribed: number; created_at: string; started_at: string | null; scheduled_at: string | null }

const STARTERS: { name: string; subject: string; html: string }[] = [
  { name: 'Offer / Sale', subject: '{{first_name}}, our festive sale is live 🎉', html: `<!doctype html>
<html><body style="margin:0;background:#f4f6f8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
    <table width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
      <tr><td style="background:#111827;color:#fff;padding:22px 26px;font-size:20px;font-weight:bold">Your Brand</td></tr>
      <tr><td style="padding:26px">
        <h1 style="margin:0 0 10px;font-size:24px;color:#111827">Hi {{first_name}}, 20% OFF this week!</h1>
        <p style="font-size:15px;line-height:1.6;color:#374151">Our biggest sale of the season is here. Use code <b>FESTIVE20</b> at checkout.</p>
        <a href="https://example.com" style="display:inline-block;margin-top:12px;background:#10b981;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Shop now</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>` },
  { name: 'Newsletter', subject: 'What’s new this month at Your Brand', html: `<!doctype html>
<html><body style="margin:0;background:#ffffff;font-family:Georgia,serif;color:#222">
  <div style="max-width:600px;margin:0 auto;padding:28px 20px">
    <h1 style="font-size:26px;margin:0 0 6px">Monthly update</h1>
    <p style="color:#666;margin:0 0 22px">Hello {{name}}, here is what happened this month.</p>
    <h2 style="font-size:18px">1. New arrivals</h2><p style="line-height:1.7">Write a short update here.</p>
    <h2 style="font-size:18px">2. Customer story</h2><p style="line-height:1.7">Share a testimonial or case study.</p>
    <p style="margin-top:28px">Reply to this email any time — we read every message.</p>
  </div>
</body></html>` },
  { name: 'Blank', subject: '', html: '<!doctype html>\n<html><body>\n  <p>Hi {{first_name}},</p>\n  <p></p>\n</body></html>' },
]

function TemplateEditor({ tpl, onClose, onSaved }: { tpl: Partial<Tpl>; onClose: () => void; onSaved: () => void }) {
  const t = useToast()
  const [f, setF] = useState({ name: tpl.name ?? '', subject: tpl.subject ?? '', html: tpl.html ?? STARTERS[0].html })
  const [preview, setPreview] = useState('')
  const [testTo, setTestTo] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const h = setTimeout(() => post<{ html: string }>('email/preview', { html: f.html }).then((r) => setPreview(r.html)).catch(() => setPreview(f.html)), 400)
    return () => clearTimeout(h)
  }, [f.html])
  return (
    <Modal open onClose={onClose} title={tpl.id ? 'Edit email template' : 'New email template'} wide="xl" footer={<>
      <div className="mr-auto flex gap-2"><Input className="w-56" placeholder="Send test to…" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        <Button variant="subtle" disabled={!testTo} onClick={async () => { try { await post('email/test', { to: testTo, subject: f.subject, html: f.html }); t.ok('Test email sent') } catch (e) { t.err(e) } }}>Send test</Button></div>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button loading={busy} disabled={!f.name} onClick={async () => { setBusy(true); try { if (tpl.id) await put(`email/templates/${tpl.id}`, f); else await post('email/templates', f); t.ok('Template saved'); onSaved(); onClose() } catch (e) { t.err(e) } finally { setBusy(false) } }}>Save template</Button>
    </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Template name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Diwali offer" /></Field>
        <Field label="Subject line" hint="Variables work here too, e.g. {{first_name}}"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
      </div>
      {!tpl.id && <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted">Start from:{STARTERS.map((s) => <button key={s.name} onClick={() => setF({ ...f, html: s.html, subject: f.subject || s.subject })} className="rounded-lg border border-line px-2.5 py-1 text-soft hover:border-brand/50">{s.name}</button>)}</div>}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-soft"><Code2 className="size-3.5" />HTML code</div>
          <textarea value={f.html} onChange={(e) => setF({ ...f, html: e.target.value })} spellCheck={false}
            className="h-[460px] w-full resize-none rounded-xl border border-line bg-[#070b0d] p-3 font-mono text-[12px] leading-relaxed text-soft outline-none focus:border-brand/60" />
          <p className="mt-1.5 text-xs text-muted">Variables: {'{{name}}'}, {'{{first_name}}'}, {'{{email}}'}, {'{{phone}}'} or any contact field. An unsubscribe link is added automatically.</p>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-soft"><Eye className="size-3.5" />Live preview</div>
          <iframe title="Email preview" sandbox="" srcDoc={preview} className="h-[460px] w-full rounded-xl border border-line bg-white" />
        </div>
      </div>
    </Modal>
  )
}

function NewCampaign({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useToast()
  const { data: tpls } = useApi<Tpl[]>('email/templates')
  const { data: tags } = useApi<{ tag: string; c: number }[]>('contacts/tags')
  const [f, setF] = useState({ name: '', template_id: 0, subject: '', aud: 'all' as 'all' | 'tags' | 'stage', tags: [] as string[], stage: 'new', when: 'now' as 'now' | 'schedule' | 'draft', at: '' })
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const audience = { type: f.aud, tags: f.tags, stage: f.stage }
  useEffect(() => {
    const h = setTimeout(() => post<{ count: number }>('email/campaigns/audience-preview', audience).then((r) => setCount(r.count)).catch(() => setCount(null)), 250)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.aud, f.tags.join(), f.stage])
  const tpl = tpls?.find((x) => x.id === f.template_id)
  return (
    <Modal open onClose={onClose} title="New email campaign" wide footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button loading={busy} disabled={!f.name || !f.template_id || (f.when === 'schedule' && !f.at)} icon={<Send className="size-4" />} onClick={async () => {
        setBusy(true)
        try { await post('email/campaigns', { name: f.name, template_id: f.template_id, subject: f.subject || undefined, audience, send: f.when, scheduled_at: f.when === 'schedule' ? new Date(f.at).toISOString() : undefined }); t.ok(f.when === 'now' ? 'Emails are sending' : 'Saved'); onDone(); onClose() }
        catch (e) { t.err(e) } finally { setBusy(false) }
      }}>{f.when === 'now' ? `Send to ${num(count ?? 0)}` : f.when === 'schedule' ? 'Schedule' : 'Save draft'}</Button></>}>
      {tpls && tpls.length === 0 ? <Empty title="Create an email template first" /> : <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Campaign name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Template"><Select value={f.template_id} onChange={(e) => setF({ ...f, template_id: Number(e.target.value) })}><option value={0}>Select…</option>{tpls?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        </div>
        <Field label="Subject (optional override)"><Input value={f.subject} placeholder={tpl?.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <div>
          <div className="mb-2 text-xs font-medium text-soft">Audience</div>
          <div className="grid grid-cols-3 gap-2">{([['all', 'All with email', Users], ['tags', 'By tags', Tag], ['stage', 'By lead stage', KanbanSquare]] as const).map(([k, l, I]) => (
            <button key={k} onClick={() => setF({ ...f, aud: k })} className={cx('flex items-center gap-2 rounded-xl border p-3 text-left text-sm', f.aud === k ? 'border-brand/60 bg-brand/10 text-white' : 'border-line text-soft')}><I className="size-4 text-brand" />{l}</button>
          ))}</div>
          {f.aud === 'tags' && <div className="mt-3"><TagInput value={f.tags} onChange={(v) => setF({ ...f, tags: v })} suggestions={tags?.map((x) => x.tag)} /></div>}
          {f.aud === 'stage' && <Select className="mt-3" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}
          <p className="mt-2 text-sm"><b className="text-brand-2">{count ?? '…'}</b> <span className="text-muted">contacts with an email address (unsubscribed excluded)</span></p>
        </div>
        <div className="flex flex-wrap gap-2">{[['now', 'Send now'], ['schedule', 'Schedule'], ['draft', 'Save draft']].map(([k, l]) => <button key={k} onClick={() => setF({ ...f, when: k as typeof f.when })} className={cx('rounded-xl border px-4 py-2 text-sm', f.when === k ? 'border-brand/60 bg-brand/10 text-white' : 'border-line text-soft')}>{l}</button>)}
          {f.when === 'schedule' && <Input type="datetime-local" className="w-56" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} />}</div>
      </div>}
    </Modal>
  )
}

function CampaignDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { data } = useApi<Camp & { recipients: { id: number; email: string; name: string; status: string; error: string | null; opened_at: string | null }[] }>(`email/campaigns/${id}`)
  return (
    <Drawer open onClose={onClose} title={data?.name ?? 'Campaign'}>
      {!data ? <Loading /> : <>
        <div className="grid grid-cols-2 gap-3">{[['Sent', data.sent], ['Opened', data.opened], ['Failed', data.failed], ['Unsubscribed', data.unsubscribed]].map(([l, v]) => <Card key={l as string}><div className="text-xs text-muted">{l}</div><div className="font-display text-xl font-bold text-white">{num(v as number)}</div></Card>)}</div>
        <Table className="mt-4" head={['Contact', 'Status', 'Opened']}>{data.recipients.map((r) => <tr key={r.id}><Td><div className="text-white">{r.name || '—'}</div><div className="text-xs text-muted">{r.email}</div></Td><Td><Badge tone={statusTone(r.status)}>{r.status}</Badge>{r.error && <div className="mt-1 max-w-48 truncate text-[11px] text-red-300">{r.error}</div>}</Td><Td className="text-xs">{r.opened_at ? dateTime(r.opened_at) : '—'}</Td></tr>)}</Table>
      </>}
    </Drawer>
  )
}

export default function Email() {
  const t = useToast()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') ?? 'campaigns') as 'campaigns' | 'templates' | 'log'
  const { data: status } = useApi<{ connected: boolean; from: string | null; contacts_with_email: number }>('email/status')
  const { data: camps, reload: rc } = useApi<Camp[]>('email/campaigns')
  const { data: tpls, reload: rt } = useApi<Tpl[]>(tab === 'templates' ? 'email/templates' : null)
  const { data: log } = useApi<{ id: number; to_email: string; subject: string; kind: string; status: string; error: string | null; created_at: string }[]>(tab === 'log' ? 'email/log' : null)
  const [edit, setEdit] = useState<Partial<Tpl> | null>(null)
  const [newCamp, setNewCamp] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const [delTpl, setDelTpl] = useState<number | null>(null)
  return (
    <>
      <PageHeader title="Email marketing" subtitle="Send bulk emails with your own HTML templates — alongside WhatsApp, to the same contacts." actions={<>
        <Button variant="outline" icon={<Code2 className="size-4" />} onClick={() => setEdit({})}>New template</Button>
        <Button icon={<Plus className="size-4" />} onClick={() => setNewCamp(true)}>New campaign</Button></>} />
      {status && !status.connected && <div className="mb-5 flex items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100"><AlertTriangle className="size-4 shrink-0" />Connect your email account (Gmail, Zoho, Hostinger…) to send emails. <Link to="/app/settings?tab=integrations" className="font-semibold underline">Connect email</Link></div>}
      {status?.connected && <p className="mb-4 text-xs text-muted">Sending from <b className="text-soft">{status.from}</b> · {num(status.contacts_with_email)} contacts have an email address</p>}
      <div className="mb-5"><Tabs value={tab} onChange={(v) => setParams({ tab: v })} tabs={[{ id: 'campaigns', label: 'Campaigns' }, { id: 'templates', label: 'Templates' }, { id: 'log', label: 'Sent log' }]} /></div>

      {tab === 'campaigns' && <Card pad={false}>
        {!camps ? <Loading /> : camps.length === 0 ? <Empty icon={<Mail className="size-5" />} title="No email campaigns yet" text="Create a template, then send it to all contacts or a tagged segment." action={<Button onClick={() => setNewCamp(true)}>New campaign</Button>} /> : (
          <Table head={['Campaign', 'Status', 'Recipients', 'Sent', 'Opened', 'Unsubscribed', 'Date', '']}>
            {camps.map((c) => <tr key={c.id} className="cursor-pointer hover:bg-white/[.02]" onClick={() => setOpen(c.id)}>
              <Td><div className="font-medium text-white">{c.name}</div><div className="text-xs text-muted">{c.template_name}</div></Td><Td><Badge tone={statusTone(c.status)}>{c.status}</Badge></Td>
              <Td>{num(c.total)}</Td><Td>{num(c.sent)}</Td><Td>{pct(c.opened, c.sent)}</Td><Td>{num(c.unsubscribed)}</Td><Td className="text-xs">{dateTime(c.started_at ?? c.scheduled_at ?? c.created_at)}</Td>
              <Td><span onClick={(e) => e.stopPropagation()}>{c.status === 'draft' && <Button size="sm" onClick={async () => { try { await post(`email/campaigns/${c.id}/send`); void rc() } catch (e) { t.err(e) } }}>Send</Button>}
                {c.status === 'running' && <Button size="sm" variant="subtle" onClick={async () => { await post(`email/campaigns/${c.id}/pause`); void rc() }}>Pause</Button>}
                {c.status === 'paused' && <Button size="sm" onClick={async () => { try { await post(`email/campaigns/${c.id}/resume`); void rc() } catch (e) { t.err(e) } }}>Resume</Button>}</span></Td>
            </tr>)}
          </Table>)}
      </Card>}

      {tab === 'templates' && (!tpls ? <Loading /> : tpls.length === 0 ? <Card><Empty icon={<Code2 className="size-5" />} title="No templates" text="Paste your own HTML or start from a ready design." action={<Button onClick={() => setEdit({})}>New template</Button>} /></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{tpls.map((x) => (
          <Card key={x.id} pad={false}>
            <iframe title={x.name} sandbox="" srcDoc={x.html} className="pointer-events-none h-48 w-full rounded-t-2xl border-b border-line bg-white" />
            <div className="flex items-center justify-between p-4"><div className="min-w-0"><div className="truncate font-medium text-white">{x.name}</div><div className="truncate text-xs text-muted">{x.subject}</div></div>
              <div className="flex gap-1"><Button size="sm" variant="subtle" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(x)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setDelTpl(x.id)}><Trash2 className="size-4" /></Button></div></div>
          </Card>))}</div>))}

      {tab === 'log' && <Card pad={false}>{!log ? <Loading /> : <Table head={['To', 'Subject', 'Type', 'Status', 'Time']}>
        {log.map((l) => <tr key={l.id}><Td className="text-white">{l.to_email}</Td><Td className="max-w-72 truncate">{l.subject}</Td><Td>{l.kind}</Td><Td><Badge tone={statusTone(l.status)}>{l.status}</Badge>{l.error && <div className="mt-1 max-w-56 truncate text-[11px] text-red-300">{l.error}</div>}</Td><Td className="text-xs">{dateTime(l.created_at)}</Td></tr>)}
      </Table>}</Card>}

      {edit && <TemplateEditor tpl={edit} onClose={() => setEdit(null)} onSaved={() => { void rt(); setParams({ tab: 'templates' }) }} />}
      {newCamp && <NewCampaign onClose={() => setNewCamp(false)} onDone={rc} />}
      {open && <CampaignDrawer id={open} onClose={() => setOpen(null)} />}
      <Confirm open={!!delTpl} onClose={() => setDelTpl(null)} title="Delete template?" text="Campaigns already sent are not affected." onConfirm={async () => { await del(`email/templates/${delTpl}`); void rt() }} />
    </>
  )
}

