import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Megaphone, Users, Tag, KanbanSquare, ListChecks, CalendarClock, Send, Save } from 'lucide-react'
import { post } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { num, pct, dateTime, titleCase } from '../../lib/format'
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, TagInput, useToast, statusTone, cx } from '../../components/ui'
import { TemplatePreview } from '../../components/WhatsAppPreview'
import type { Campaign, Template, WaNumber } from '../../lib/types'

function NewCampaign({ open, onClose, preset }: { open: boolean; onClose: () => void; preset?: number[] }) {
  const t = useToast()
  const nav = useNavigate()
  const { data: templates } = useApi<Template[]>(open ? 'templates?status=APPROVED' : null)
  const { data: numbers } = useApi<WaNumber[]>(open ? 'numbers' : null)
  const { data: tags } = useApi<{ tag: string; c: number }[]>(open ? 'contacts/tags' : null)
  const [f, setF] = useState({ name: '', template_id: 0, number_id: 0, vars: [] as string[], header_media: '', buttonVal: '', aud: (preset?.length ? 'contacts' : 'tags') as 'all' | 'tags' | 'stage' | 'contacts', tags: [] as string[], match: 'any', stage: 'new', when: 'now' as 'now' | 'schedule' | 'draft', at: '' })
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const tpl = templates?.find((x) => x.id === f.template_id)
  const body = tpl?.components.find((c) => c.type === 'BODY')?.text ?? ''
  const varCount = new Set(body.match(/\{\{\d+\}\}/g) ?? []).size
  const header = tpl?.components.find((c) => c.type === 'HEADER')
  const urlBtnIdx = tpl?.components.find((c) => c.type === 'BUTTONS')?.buttons?.findIndex((b) => b.type === 'URL' && b.url?.includes('{{1}}')) ?? -1
  const audience = { type: f.aud, tags: f.tags, match: f.match, stage: f.stage, contact_ids: preset }

  useEffect(() => {
    if (!open) return
    const h = setTimeout(() => post<{ count: number }>('campaigns/audience-preview', audience).then((r) => setCount(r.count)).catch(() => setCount(null)), 250)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, f.aud, f.tags.join(), f.match, f.stage])

  const submit = async () => {
    setBusy(true)
    try {
      const c = await post<Campaign>('campaigns', {
        name: f.name, template_id: f.template_id, number_id: f.number_id || undefined, audience, send: f.when,
        scheduled_at: f.when === 'schedule' ? new Date(f.at).toISOString() : undefined,
        template_vars: { body: f.vars.slice(0, varCount), header_media: f.header_media || undefined, buttons: urlBtnIdx >= 0 && f.buttonVal ? [{ index: urlBtnIdx, value: f.buttonVal }] : undefined },
      })
      t.ok(f.when === 'now' ? 'Campaign is sending' : f.when === 'schedule' ? 'Campaign scheduled' : 'Draft saved')
      nav(`/app/campaigns/${c.id}`)
    } catch (e) { t.err(e) } finally { setBusy(false) }
  }

  const audOpts: [string, string, typeof Users][] = [['all', 'All contacts', Users], ['tags', 'By tags', Tag], ['stage', 'By lead stage', KanbanSquare], ...(preset?.length ? [['contacts', `Selected (${preset.length})`, ListChecks] as [string, string, typeof Users]] : [])]
  return (
    <Modal open={open} onClose={onClose} title="New broadcast campaign" wide="xl" footer={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button loading={busy} disabled={!f.name || !tpl || (f.when !== 'draft' && !count) || (f.when === 'schedule' && !f.at)} icon={f.when === 'now' ? <Send className="size-4" /> : f.when === 'schedule' ? <CalendarClock className="size-4" /> : <Save className="size-4" />} onClick={submit}>
        {f.when === 'now' ? `Send to ${num(count ?? 0)} contacts` : f.when === 'schedule' ? 'Schedule' : 'Save draft'}
      </Button>
    </>}>
      {templates && templates.length === 0 ? <Empty title="You need an approved template" text="WhatsApp only allows approved templates for broadcasts." action={<Link to="/app/templates"><Button>Create template</Button></Link>} /> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Campaign name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Diwali offer 2026" /></Field>
              {(numbers?.length ?? 0) > 1 ? <Field label="Send from"><Select value={f.number_id} onChange={(e) => setF({ ...f, number_id: Number(e.target.value) })}><option value={0}>Default number</option>{numbers?.map((n) => <option key={n.id} value={n.id}>{n.label} {n.display_phone}</option>)}</Select></Field> : <div />}
            </div>
            <Field label="Template"><Select value={f.template_id} onChange={(e) => setF({ ...f, template_id: Number(e.target.value), vars: [] })}><option value={0}>Select approved template…</option>{templates?.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.language} · {x.category.toLowerCase()}</option>)}</Select></Field>
            {tpl && (varCount > 0 || (header?.format && header.format !== 'TEXT') || urlBtnIdx >= 0) && (
              <div className="rounded-xl border border-line bg-panel p-4">
                <div className="mb-3 text-xs font-medium text-soft">Personalisation — use {'{{name}}'}, {'{{first_name}}'} or any contact field like {'{{city}}'}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {header?.format && header.format !== 'TEXT' && <Field label={`Header ${header.format.toLowerCase()} URL`} className="sm:col-span-2"><Input value={f.header_media} onChange={(e) => setF({ ...f, header_media: e.target.value })} placeholder="https://…" /></Field>}
                  {[...Array(varCount)].map((_, i) => <Field key={i} label={`{{${i + 1}}}`}><Input value={f.vars[i] ?? ''} placeholder={i === 0 ? '{{first_name}}' : ''} onChange={(e) => { const v = [...f.vars]; v[i] = e.target.value; setF({ ...f, vars: v }) }} /></Field>)}
                  {urlBtnIdx >= 0 && <Field label="Button URL suffix"><Input value={f.buttonVal} onChange={(e) => setF({ ...f, buttonVal: e.target.value })} /></Field>}
                </div>
              </div>
            )}
            <div>
              <div className="mb-2 text-xs font-medium text-soft">Audience</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {audOpts.map(([id, label, Icon]) => (
                  <button key={id} onClick={() => setF({ ...f, aud: id as typeof f.aud })} className={cx('flex flex-col items-start gap-2 rounded-xl border p-3 text-left text-sm transition', f.aud === id ? 'border-brand/60 bg-brand/10 text-white' : 'border-line bg-panel text-soft hover:border-line-strong')}>
                    <Icon className="size-4 text-brand" />{label}
                  </button>
                ))}
              </div>
              {f.aud === 'tags' && <div className="mt-3 flex gap-2"><div className="flex-1"><TagInput value={f.tags} onChange={(v) => setF({ ...f, tags: v })} suggestions={tags?.map((x) => x.tag)} placeholder="Type tags…" /></div>
                <Select className="w-36" value={f.match} onChange={(e) => setF({ ...f, match: e.target.value })}><option value="any">Any tag</option><option value="all">All tags</option></Select></div>}
              {f.aud === 'stage' && <Select className="mt-3" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}
              <p className="mt-2 text-sm"><b className="text-brand-2">{count === null ? '…' : num(count)}</b> <span className="text-muted">recipients (opted-out contacts are excluded automatically)</span></p>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-soft">When</div>
              <div className="flex flex-wrap gap-2">
                {[['now', 'Send now'], ['schedule', 'Schedule'], ['draft', 'Save as draft']].map(([id, l]) => <button key={id} onClick={() => setF({ ...f, when: id as typeof f.when })} className={cx('rounded-xl border px-4 py-2 text-sm', f.when === id ? 'border-brand/60 bg-brand/10 text-white' : 'border-line text-soft')}>{l}</button>)}
                {f.when === 'schedule' && <Input type="datetime-local" className="w-56" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} />}
              </div>
            </div>
          </div>
          <div>{tpl ? <TemplatePreview components={tpl.components} vars={f.vars.map((v) => v.replace('{{first_name}}', 'Aman').replace('{{name}}', 'Aman Sharma'))} /> : <div className="wa-bg grid h-64 place-items-center rounded-xl text-sm text-muted">Template preview</div>}
            <p className="mt-3 text-xs text-muted">Meta charges per delivered marketing message. Sending to people who did not opt in can lower your number’s quality rating.</p></div>
        </div>
      )}
    </Modal>
  )
}

export default function Campaigns() {
  const [params, setParams] = useSearchParams()
  const { data } = useApi<Campaign[]>('campaigns')
  const preset = params.get('contacts')?.split(',').map(Number).filter(Boolean)
  const open = params.get('new') === '1'
  const totals = (data ?? []).reduce((a, c) => ({ sent: a.sent + c.sent + c.failed, delivered: a.delivered + c.delivered, read: a.read + c.read, replied: a.replied + c.replied }), { sent: 0, delivered: 0, read: 0, replied: 0 })
  return (
    <>
      <PageHeader title="Campaigns" subtitle="Broadcast approved templates to segmented audiences and track every step." actions={<Button icon={<Plus className="size-4" />} onClick={() => setParams({ new: '1' })}>New campaign</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['Sent', totals.sent], ['Delivered', totals.delivered], ['Read', totals.read], ['Replied', totals.replied]].map(([l, v]) => <Card key={l as string}><div className="text-xs text-muted">{l}</div><div className="mt-1 font-display text-2xl font-bold text-white">{num(v as number)}</div></Card>)}
      </div>
      <Card pad={false}>
        {!data ? <Loading /> : data.length === 0 ? <Empty icon={<Megaphone className="size-5" />} title="No campaigns yet" text="Send offers, updates and reminders to thousands of customers in one click." action={<Button onClick={() => setParams({ new: '1' })}>Create campaign</Button>} /> : (
          <Table head={['Campaign', 'Status', 'Recipients', 'Delivered', 'Read', 'Replied', 'Failed', 'Date']}>
            {data.map((c) => (
              <tr key={c.id} className="hover:bg-white/[.02]">
                <Td><Link to={`/app/campaigns/${c.id}`} className="font-medium text-white hover:text-brand-2">{c.name}</Link><div className="text-xs text-muted">{c.template_name}</div></Td>
                <Td><Badge tone={statusTone(c.status)}>{c.status}</Badge></Td>
                <Td>{num(c.total)}</Td><Td>{pct(c.delivered, c.total)}</Td><Td>{pct(c.read, c.total)}</Td><Td>{pct(c.replied, c.total)}</Td>
                <Td className={c.failed ? 'text-red-300' : ''}>{num(c.failed)}</Td>
                <Td className="text-xs">{c.status === 'scheduled' ? `⏰ ${dateTime(c.scheduled_at)}` : dateTime(c.started_at ?? c.created_at)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <NewCampaign open={open} preset={preset} onClose={() => setParams({})} />
    </>
  )
}
