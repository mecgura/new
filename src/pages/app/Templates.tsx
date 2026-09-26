import { useState } from 'react'
import { Plus, RefreshCw, Trash2, Sparkles, FileText, X } from 'lucide-react'
import { post, del } from '../../lib/api'
import { useApi } from '../../lib/hooks'
import { date } from '../../lib/format'
import { Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Textarea, useToast, statusTone, Confirm } from '../../components/ui'
import { TemplatePreview, type TplComponent } from '../../components/WhatsAppPreview'
import type { Template } from '../../lib/types'

type Btn = { type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'; text: string; url?: string; phone_number?: string }

function Builder({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useToast()
  const [f, setF] = useState({ name: '', language: 'en', category: 'MARKETING', headerType: 'NONE', headerText: '', body: '', footer: '', examples: [] as string[], headerExample: '' })
  const [buttons, setButtons] = useState<Btn[]>([])
  const [busy, setBusy] = useState(false)
  const [ai, setAi] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const vars = [...new Set(f.body.match(/\{\{\d+\}\}/g) ?? [])]
  const components: TplComponent[] & Record<string, unknown>[] = []
  if (f.headerType === 'TEXT' && f.headerText) components.push({ type: 'HEADER', format: 'TEXT', text: f.headerText })
  else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(f.headerType)) components.push({ type: 'HEADER', format: f.headerType, ...(f.headerExample ? { example: { header_handle: [f.headerExample] } } : {}) } as TplComponent)
  components.push({ type: 'BODY', text: f.body, ...(vars.length ? { example: { body_text: [vars.map((_, i) => f.examples[i] || `sample${i + 1}`)] } } : {}) } as TplComponent)
  if (f.footer) components.push({ type: 'FOOTER', text: f.footer })
  if (buttons.length) components.push({ type: 'BUTTONS', buttons: buttons.map((b) => b.type === 'URL' ? { ...b, ...(b.url?.includes('{{1}}') ? { example: [b.url.replace('{{1}}', 'demo')] } : {}) } : b) } as TplComponent)

  return (
    <Modal open={open} onClose={onClose} title="Create message template" wide="xl" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.name || !f.body} onClick={async () => {
      setBusy(true)
      try { await post('templates', { name: f.name, language: f.language, category: f.category, components }); t.ok('Template submitted to Meta for approval'); onSaved(); onClose() } catch (e) { t.err(e) } finally { setBusy(false) }
    }}>Submit for approval</Button></>}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" hint="lowercase_with_underscores"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="festive_offer" /></Field>
            <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="MARKETING">Marketing</option><option value="UTILITY">Utility</option><option value="AUTHENTICATION">Authentication</option></Select></Field>
            <Field label="Language"><Select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>{[['en', 'English'], ['en_US', 'English (US)'], ['hi', 'Hindi'], ['pa', 'Punjabi'], ['gu', 'Gujarati'], ['mr', 'Marathi'], ['ta', 'Tamil'], ['te', 'Telugu'], ['bn', 'Bengali']].map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <Field label="Header"><Select value={f.headerType} onChange={(e) => setF({ ...f, headerType: e.target.value })}><option value="NONE">None</option><option value="TEXT">Text</option><option value="IMAGE">Image</option><option value="VIDEO">Video</option><option value="DOCUMENT">Document</option></Select></Field>
            {f.headerType === 'TEXT' && <Field label="Header text"><Input maxLength={60} value={f.headerText} onChange={(e) => setF({ ...f, headerText: e.target.value })} /></Field>}
            {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(f.headerType) && <Field label="Sample media handle (optional)" hint="Media is attached per campaign"><Input value={f.headerExample} onChange={(e) => setF({ ...f, headerExample: e.target.value })} /></Field>}
          </div>
          <div className="rounded-xl border border-brand/20 bg-brand/5 p-3">
            <div className="flex gap-2"><Input value={ai} onChange={(e) => setAi(e.target.value)} placeholder="✨ Describe the message, e.g. Diwali 20% off on salon services, book via WhatsApp" />
              <Button variant="subtle" loading={aiBusy} icon={<Sparkles className="size-4 text-brand-2" />} onClick={async () => {
                if (!ai) return; setAiBusy(true)
                try { const r = await post<{ text: string }>('ai/write', { kind: 'template', brief: ai }); setF({ ...f, body: r.text }) } catch (e) { t.err(e) } finally { setAiBusy(false) }
              }}>Write</Button></div>
          </div>
          <Field label="Body" hint="Use {{1}}, {{2}} for personalised values. *bold* and _italic_ supported."><Textarea rows={6} maxLength={1024} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          {vars.length > 0 && <div className="grid gap-3 sm:grid-cols-3">{vars.map((v, i) => <Field key={v} label={`Sample for ${v}`}><Input value={f.examples[i] ?? ''} onChange={(e) => { const x = [...f.examples]; x[i] = e.target.value; setF({ ...f, examples: x }) }} /></Field>)}</div>}
          <Field label="Footer (optional)"><Input maxLength={60} value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} placeholder="Reply STOP to unsubscribe" /></Field>
          <div>
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-soft">Buttons</span>
              <div className="flex gap-1">{(['QUICK_REPLY', 'URL', 'PHONE_NUMBER'] as const).map((ty) => <Button key={ty} size="sm" variant="subtle" disabled={buttons.length >= 10} onClick={() => setButtons([...buttons, { type: ty, text: '' }])}>+ {ty === 'QUICK_REPLY' ? 'Quick reply' : ty === 'URL' ? 'Link' : 'Call'}</Button>)}</div></div>
            <div className="space-y-2">{buttons.map((b, i) => (
              <div key={i} className="flex gap-2">
                <Badge className="h-10 w-24 justify-center">{b.type === 'QUICK_REPLY' ? 'Reply' : b.type === 'URL' ? 'Link' : 'Call'}</Badge>
                <Input maxLength={25} placeholder="Button text" value={b.text} onChange={(e) => setButtons(buttons.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
                {b.type === 'URL' && <Input placeholder="https://site.com/{{1}}" value={b.url ?? ''} onChange={(e) => setButtons(buttons.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />}
                {b.type === 'PHONE_NUMBER' && <Input placeholder="+917837722567" value={b.phone_number ?? ''} onChange={(e) => setButtons(buttons.map((x, j) => j === i ? { ...x, phone_number: e.target.value } : x))} />}
                <Button variant="ghost" className="h-10" onClick={() => setButtons(buttons.filter((_, j) => j !== i))}><X className="size-4" /></Button>
              </div>
            ))}</div>
          </div>
        </div>
        <div><TemplatePreview components={components} vars={f.examples} /><p className="mt-3 text-xs text-muted">Meta usually reviews templates within minutes to 24 hours. Avoid misleading claims and all-caps text to improve approval chances.</p></div>
      </div>
    </Modal>
  )
}

export default function Templates() {
  const t = useToast()
  const { data, reload } = useApi<Template[]>('templates')
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [delId, setDelId] = useState<number | null>(null)
  const [filter, setFilter] = useState('')
  const list = (data ?? []).filter((x) => !filter || x.status === filter)
  return (
    <>
      <PageHeader title="Message templates" subtitle="Pre-approved messages for campaigns, notifications and starting new conversations." actions={<>
        <Button variant="outline" loading={syncing} icon={<RefreshCw className="size-4" />} onClick={async () => { setSyncing(true); try { const r = await post<{ synced: number }>('templates/sync'); t.ok(`Synced ${r.synced} templates from Meta`); void reload() } catch (e) { t.err(e) } finally { setSyncing(false) } }}>Sync from Meta</Button>
        <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>New template</Button>
      </>} />
      <div className="mb-4 flex gap-2">{['', 'APPROVED', 'PENDING', 'REJECTED'].map((s) => <button key={s} onClick={() => setFilter(s)} className={`rounded-full border px-3 py-1 text-xs ${filter === s ? 'border-brand/50 bg-brand/10 text-white' : 'border-line text-muted'}`}>{s ? s.toLowerCase() : 'all'}</button>)}</div>
      {!data ? <Loading /> : list.length === 0 ? <Card><Empty icon={<FileText className="size-5" />} title="No templates" text="Create your first template or sync existing ones from your WhatsApp Business Account." action={<Button onClick={() => setOpen(true)}>Create template</Button>} /></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((tp) => (
            <Card key={tp.id} pad={false} className="flex flex-col">
              <div className="flex items-start justify-between gap-2 px-4 pt-4">
                <div className="min-w-0"><div className="truncate font-mono text-sm text-white">{tp.name}</div><div className="mt-1 flex gap-1.5"><Badge>{tp.category.toLowerCase()}</Badge><Badge>{tp.language}</Badge></div></div>
                <Badge tone={statusTone(tp.status)}>{tp.status.toLowerCase()}</Badge>
              </div>
              <div className="flex-1 p-4"><TemplatePreview components={tp.components} /></div>
              {tp.rejection_reason && <p className="px-4 pb-2 text-xs text-red-300">Reason: {tp.rejection_reason}</p>}
              <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted"><span>Updated {date(tp.updated_at)}</span><button onClick={() => setDelId(tp.id)} className="hover:text-red-300"><Trash2 className="size-4" /></button></div>
            </Card>
          ))}
        </div>
      )}
      <Builder open={open} onClose={() => setOpen(false)} onSaved={reload} />
      <Confirm open={!!delId} onClose={() => setDelId(null)} title="Delete template?" text="It will also be deleted from your WhatsApp Business Account. The same name cannot be reused for 30 days." onConfirm={async () => { await del(`templates/${delId}`); void reload() }} />
    </>
  )
}
