import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Plus, Upload, Download, Search, Trash2, Tag, MessageSquare, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { get, post, patch, download } from '../../lib/api'
import { useApi, useDebounced } from '../../lib/hooks'
import { useSession } from '../../lib/session'
import { phone, date, dateTime, titleCase, inr } from '../../lib/format'
import { Avatar, Badge, Button, Card, Drawer, Empty, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, Textarea, TagInput, useToast, statusTone, Confirm } from '../../components/ui'
import type { Contact, Member } from '../../lib/types'

const STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']

type Full = Contact & { notes: { id: number; body: string; user_name: string; created_at: string }[]; conversations: { id: number; status: string; last_message_at: string; number_label: string }[];
  orders: { id: number; total: number; status: string }[]; payments: { id: number; amount: number; status: string; description: string }[]; sequences: { name: string; status: string }[]; campaigns: { name: string; status: string; sent_at: string }[] }

function ContactDrawer({ id, onClose, onChanged, members, tags }: { id: number; onClose: () => void; onChanged: () => void; members: Member[]; tags: string[] }) {
  const t = useToast()
  const { can } = useSession()
  const [c, setC] = useState<Full | null>(null)
  const [note, setNote] = useState('')
  const [attrKey, setAttrKey] = useState(''); const [attrVal, setAttrVal] = useState('')
  const load = () => get<Full>(`contacts/${id}`).then(setC).catch(t.err)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { get<Full>(`contacts/${id}`).then(setC).catch(t.err) }, [id])
  const save = async (body: Partial<Contact>) => { try { await patch(`contacts/${id}`, body); await load(); onChanged() } catch (e) { t.err(e) } }
  const edit = can('contacts.manage')
  return (
    <Drawer open onClose={onClose} title="Contact">
      {!c ? <Loading /> : (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Avatar name={c.name || c.wa_id} className="size-14 text-base" />
            <div className="min-w-0 flex-1">
              <input disabled={!edit} defaultValue={c.name ?? ''} placeholder="Add name" onBlur={(e) => e.target.value !== (c.name ?? '') && save({ name: e.target.value })} className="w-full bg-transparent font-display text-lg font-semibold text-white outline-none" />
              <div className="text-sm text-muted">{phone(c.wa_id)} · added {date(c.created_at)} · {c.source}</div>
            </div>
            {c.conversations[0] && <Link to={`/app/inbox?c=${c.conversations[0].id}`}><Button size="sm" icon={<MessageSquare className="size-4" />}>Chat</Button></Link>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email"><Input disabled={!edit} defaultValue={c.email ?? ''} onBlur={(e) => e.target.value !== (c.email ?? '') && save({ email: e.target.value })} /></Field>
            <Field label="Stage"><Select disabled={!edit} value={c.stage} onChange={(e) => save({ stage: e.target.value })}>{STAGES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
            <Field label="Owner"><Select disabled={!edit} value={c.owner_id ?? ''} onChange={(e) => save({ owner_id: e.target.value ? Number(e.target.value) : null })}><option value="">No owner</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}</Select></Field>
            <Field label="Deal value (₹)"><Input disabled={!edit} type="number" defaultValue={c.deal_value} onBlur={(e) => Number(e.target.value) !== c.deal_value && save({ deal_value: Number(e.target.value) || 0 })} /></Field>
          </div>
          <Field label="Tags"><TagInput value={c.tags} suggestions={tags} onChange={(v) => save({ tags: v })} /></Field>
          <div className="flex items-center justify-between rounded-xl border border-line bg-panel px-4 py-3 text-sm">
            <span className="text-soft">Marketing messages</span>
            {c.opted_out ? <Button size="sm" variant="subtle" onClick={() => save({ opted_out: false } as unknown as Partial<Contact>)}>Opted out · Re-subscribe</Button> : <Button size="sm" variant="subtle" onClick={() => save({ opted_out: true } as unknown as Partial<Contact>)}>Subscribed · Opt out</Button>}
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-soft">Custom fields</div>
            <div className="divide-y divide-line rounded-xl border border-line bg-panel">
              {Object.entries(c.attributes).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span className="text-muted">{k}</span><span className="flex items-center gap-2 truncate text-white">{String(typeof v === 'object' ? JSON.stringify(v) : v)}
                  {edit && <button onClick={() => { const a = { ...c.attributes }; delete a[k]; void save({ attributes: a }) }}><Trash2 className="size-3.5 text-muted hover:text-red-300" /></button>}</span></div>
              ))}
              {edit && <form className="flex gap-2 p-2" onSubmit={(e) => { e.preventDefault(); if (attrKey) { void save({ attributes: { ...c.attributes, [attrKey.trim().toLowerCase().replace(/\s+/g, '_')]: attrVal } }); setAttrKey(''); setAttrVal('') } }}>
                <Input className="!h-8 text-xs" placeholder="Field (e.g. city)" value={attrKey} onChange={(e) => setAttrKey(e.target.value)} />
                <Input className="!h-8 text-xs" placeholder="Value" value={attrVal} onChange={(e) => setAttrVal(e.target.value)} />
                <Button size="sm" variant="subtle">Add</Button>
              </form>}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-medium text-soft">Notes</div>
            <form onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await post(`contacts/${c.id}/notes`, { body: note }); setNote(''); void load() }}>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a private note…" /><Button size="sm" variant="subtle" className="mt-2">Save note</Button>
            </form>
            <div className="mt-3 space-y-2">{c.notes.map((n) => <div key={n.id} className="rounded-xl border border-line bg-panel p-3 text-sm"><p className="whitespace-pre-wrap text-soft">{n.body}</p><p className="mt-1 text-xs text-muted">{n.user_name} · {dateTime(n.created_at)}</p></div>)}</div>
          </div>
          {(c.orders.length > 0 || c.payments.length > 0) && <div className="grid gap-3 sm:grid-cols-2">
            <Card title="Orders">{c.orders.map((o) => <div key={o.id} className="flex justify-between py-1 text-sm"><span>#{o.id} · {inr(o.total)}</span><Badge tone={statusTone(o.status)}>{o.status}</Badge></div>)}</Card>
            <Card title="Payments">{c.payments.map((p) => <div key={p.id} className="flex justify-between py-1 text-sm"><span className="truncate">{inr(p.amount)}</span><Badge tone={statusTone(p.status)}>{p.status}</Badge></div>)}</Card>
          </div>}
          {c.campaigns.length > 0 && <div><div className="mb-2 text-xs font-medium text-soft">Campaign history</div>{c.campaigns.map((x, i) => <div key={i} className="flex justify-between border-b border-line py-2 text-sm"><span className="text-soft">{x.name}</span><Badge tone={statusTone(x.status)}>{x.status}</Badge></div>)}</div>}
        </div>
      )}
    </Drawer>
  )
}

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const t = useToast()
  const [csv, setCsv] = useState('')
  const [name, setName] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  return (
    <Modal open={open} onClose={onClose} title="Import contacts from CSV" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!csv} loading={busy} onClick={async () => {
      setBusy(true)
      try { const r = await post<{ created: number; updated: number; invalid: number }>('contacts/import', { csv, tags }); t.ok(`Imported: ${r.created} new, ${r.updated} updated${r.invalid ? `, ${r.invalid} invalid numbers skipped` : ''}`); onDone(); onClose(); setCsv(''); setName('') }
      catch (e) { t.err(e) } finally { setBusy(false) }
    }}>Import</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Columns: <code className="text-white">phone</code> (required), <code className="text-white">name</code>, <code className="text-white">email</code>, <code className="text-white">tags</code> (separate with ;), <code className="text-white">stage</code>. Any other column becomes a custom field. 10-digit numbers are treated as Indian (+91).</p>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line-strong bg-panel px-4 py-8 text-center hover:border-brand/50">
          <Upload className="size-6 text-brand" /><span className="text-sm text-white">{name || 'Choose a .csv file'}</span><span className="text-xs text-muted">Export from Excel / Google Sheets as CSV</span>
          <input type="file" accept=".csv,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setName(f.name); setCsv(await f.text()) } }} />
        </label>
        <Field label="Add these tags to all imported contacts"><TagInput value={tags} onChange={setTags} /></Field>
        <p className="text-xs text-muted">Only import people who agreed to receive WhatsApp messages from your business.</p>
      </div>
    </Modal>
  )
}

export default function Contacts() {
  const { can } = useSession()
  const t = useToast()
  const [params, setParams] = useSearchParams()
  const [f, setF] = useState({ q: '', tag: '', stage: '', page: 1 })
  const q = useDebounced(f.q)
  const qs = new URLSearchParams({ page: String(f.page), limit: '50', ...(q && { q }), ...(f.tag && { tag: f.tag }), ...(f.stage && { stage: f.stage }) }).toString()
  const { data, reload } = useApi<{ data: Contact[]; total: number }>(`contacts?${qs}`)
  const { data: tags, reload: reloadTags } = useApi<{ tag: string; c: number }[]>('contacts/tags')
  const { data: team } = useApi<{ members: Member[] }>('team')
  const { data: seqs } = useApi<{ id: number; name: string }[]>(can('automation.manage') ? 'sequences' : null)
  const { data: flows } = useApi<{ id: number; name: string }[]>(can('automation.manage') ? 'flows' : null)
  const [sel, setSel] = useState<number[]>([])
  const [modal, setModal] = useState<'' | 'new' | 'import' | 'bulk-tag' | 'delete'>('')
  const [nc, setNc] = useState({ name: '', phone: '', email: '', tags: [] as string[] })
  const [bulkVal, setBulkVal] = useState('')
  const openId = Number(params.get('open')) || null
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 50))

  const bulk = async (action: string, value?: string | number) => {
    try { const r = await post<{ affected: number }>('contacts/bulk', { ids: sel, action, value }); t.ok(`Updated ${r.affected} contacts`); setSel([]); void reload(); void reloadTags() } catch (e) { t.err(e) }
  }

  return (
    <>
      <PageHeader title="Contacts" subtitle={`${(data?.total ?? 0).toLocaleString('en-IN')} contacts · your WhatsApp CRM`} actions={can('contacts.manage') && <>
        <Button variant="outline" icon={<Download className="size-4" />} onClick={() => download(`/api/contacts/export?${qs}`, 'mecgura-contacts.csv')}>Export</Button>
        <Button variant="outline" icon={<Upload className="size-4" />} onClick={() => setModal('import')}>Import CSV</Button>
        <Button icon={<Plus className="size-4" />} onClick={() => setModal('new')}>Add contact</Button>
      </>} />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><Input className="pl-9" placeholder="Search by name, phone or email" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} /></div>
        <Select className="sm:w-48" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value, page: 1 })}><option value="">All tags</option>{tags?.map((x) => <option key={x.tag} value={x.tag}>{x.tag} ({x.c})</option>)}</Select>
        <Select className="sm:w-44" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value, page: 1 })}><option value="">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
      </div>

      {sel.length > 0 && can('contacts.manage') && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 px-4 py-2.5 text-sm">
          <b className="text-white">{sel.length} selected</b>
          <Button size="sm" variant="subtle" icon={<Tag className="size-3.5" />} onClick={() => setModal('bulk-tag')}>Add tag</Button>
          <Select className="!h-8 w-40 text-xs" value="" onChange={(e) => e.target.value && bulk('set_stage', e.target.value)}><option value="">Set stage…</option>{STAGES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>
          {seqs && seqs.length > 0 && <Select className="!h-8 w-44 text-xs" value="" onChange={(e) => e.target.value && bulk('add_to_sequence', Number(e.target.value))}><option value="">Add to follow-up…</option>{seqs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
          {flows && flows.length > 0 && <Select className="!h-8 w-40 text-xs" value="" onChange={(e) => e.target.value && bulk('start_flow', Number(e.target.value))}><option value="">Start flow…</option>{flows.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
          <Link to={`/app/campaigns?new=1&contacts=${sel.join(',')}`}><Button size="sm" variant="subtle">Send campaign</Button></Link>
          <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setModal('delete')}>Delete</Button>
          <button className="ml-auto text-xs text-muted hover:text-white" onClick={() => setSel([])}>Clear</button>
        </div>
      )}

      <Card pad={false}>
        {!data ? <Loading /> : data.data.length === 0 ? <Empty title="No contacts found" icon={<Users className="size-5" />} text="Import a CSV, add contacts manually, or they will be created automatically when customers message you." /> : (
          <Table head={[<input key="all" type="checkbox" className="accent-emerald-500" checked={sel.length === data.data.length} onChange={(e) => setSel(e.target.checked ? data.data.map((c) => c.id) : [])} />, 'Contact', 'Tags', 'Stage', 'Owner', 'Last seen', '']}>
            {data.data.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-white/[.02]" onClick={() => setParams({ open: String(c.id) })}>
                <Td><input type="checkbox" className="accent-emerald-500" checked={sel.includes(c.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} /></Td>
                <Td><div className="flex items-center gap-3"><Avatar name={c.name || c.wa_id} className="size-8 text-[11px]" /><div><div className="font-medium text-white">{c.name || '—'}</div><div className="text-xs text-muted">{phone(c.wa_id)}</div></div></div></Td>
                <Td><div className="flex max-w-56 flex-wrap gap-1">{c.tags.slice(0, 3).map((x) => <Badge key={x} tone="green">{x}</Badge>)}{c.tags.length > 3 && <Badge>+{c.tags.length - 3}</Badge>}</div></Td>
                <Td><Badge tone={statusTone(c.stage)}>{titleCase(c.stage)}</Badge>{c.opted_out ? <Badge tone="red" className="ml-1">opted out</Badge> : null}</Td>
                <Td className="text-xs">{c.owner_name ?? '—'}</Td>
                <Td className="text-xs">{c.last_seen_at ? dateTime(c.last_seen_at) : '—'}</Td>
                <Td className="text-right text-xs text-muted">{c.source}</Td>
              </tr>
            ))}
          </Table>
        )}
        {pages > 1 && <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
          <span>Page {f.page} of {pages}</span>
          <div className="flex gap-2"><Button size="sm" variant="subtle" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}><ChevronLeft className="size-4" /></Button><Button size="sm" variant="subtle" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}><ChevronRight className="size-4" /></Button></div>
        </div>}
      </Card>

      <Modal open={modal === 'new'} onClose={() => setModal('')} title="Add contact" footer={<><Button variant="ghost" onClick={() => setModal('')}>Cancel</Button><Button onClick={async () => {
        try { await post('contacts', { ...nc, email: nc.email || undefined }); t.ok('Contact added'); setModal(''); setNc({ name: '', phone: '', email: '', tags: [] }); void reload(); void reloadTags() } catch (e) { t.err(e) }
      }}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="WhatsApp number" hint="Include country code. 10-digit numbers get +91."><Input value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Name"><Input value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} /></Field><Field label="Email"><Input value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} /></Field></div>
          <Field label="Tags"><TagInput value={nc.tags} suggestions={tags?.map((x) => x.tag)} onChange={(v) => setNc({ ...nc, tags: v })} /></Field>
        </div>
      </Modal>
      <Modal open={modal === 'bulk-tag'} onClose={() => setModal('')} title={`Add tag to ${sel.length} contacts`} footer={<Button disabled={!bulkVal} onClick={() => { void bulk('add_tag', bulkVal); setModal(''); setBulkVal('') }}>Add tag</Button>}>
        <Input list="tag-list" value={bulkVal} onChange={(e) => setBulkVal(e.target.value)} placeholder="e.g. diwali-2026" />
        <datalist id="tag-list">{tags?.map((x) => <option key={x.tag} value={x.tag} />)}</datalist>
      </Modal>
      <Confirm open={modal === 'delete'} onClose={() => setModal('')} title="Delete contacts?" text={`This permanently deletes ${sel.length} contacts and their chat history.`} confirmLabel="Delete" onConfirm={() => bulk('delete')} />
      <ImportModal open={modal === 'import'} onClose={() => setModal('')} onDone={() => { void reload(); void reloadTags() }} />
      {openId && <ContactDrawer key={openId} id={openId} onClose={() => setParams({})} onChanged={() => { void reload(); void reloadTags() }} members={team?.members ?? []} tags={tags?.map((x) => x.tag) ?? []} />}
    </>
  )
}

