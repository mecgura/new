import { Plus, X } from 'lucide-react'
import { Field, Input, Select, Textarea, Button } from './ui'
import { Bubble } from './WhatsAppPreview'
import { replyText, type Reply } from '../lib/reply'

export type { Reply }

function StringList({ value, onChange, max, placeholder, maxLen }: { value: string[]; onChange: (v: string[]) => void; max: number; placeholder: string; maxLen: number }) {
  return (
    <div className="space-y-2">
      {value.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Input value={v} maxLength={maxLen} placeholder={`${placeholder} ${i + 1}`} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
          <Button variant="ghost" size="sm" className="h-10" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove"><X className="size-4" /></Button>
        </div>
      ))}
      {value.length < max && <Button variant="subtle" size="sm" icon={<Plus className="size-3.5" />} onClick={() => onChange([...value, ''])}>Add</Button>}
    </div>
  )
}

/** Editor for a WhatsApp reply (text, media, reply buttons, list menu, link button) with live preview. */
export default function ReplyEditor({ value, onChange, preview = true }: { value: Reply; onChange: (r: Reply) => void; preview?: boolean }) {
  const setType = (t: Reply['type']) => {
    const text = replyText(value)
    onChange(t === 'text' ? { type: 'text', text } : t === 'media' ? { type: 'media', media_type: 'image', link: '', caption: text }
      : t === 'buttons' ? { type: 'buttons', text, buttons: ['Yes', 'No'] } : t === 'list' ? { type: 'list', text, button: 'View options', items: ['Option 1', 'Option 2'] }
        : { type: 'cta_url', text, display_text: 'Visit website', url: 'https://' })
  }
  return (
    <div className={preview ? 'grid gap-5 md:grid-cols-[1fr_280px]' : ''}>
      <div className="space-y-4">
        <Field label="Reply type">
          <Select value={value.type} onChange={(e) => setType(e.target.value as Reply['type'])}>
            <option value="text">Text message</option><option value="buttons">Quick reply buttons (max 3)</option><option value="list">List menu (max 10)</option>
            <option value="cta_url">Link button</option><option value="media">Image / video / document</option>
          </Select>
        </Field>
        {value.type === 'media' ? <>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Media"><Select value={value.media_type} onChange={(e) => onChange({ ...value, media_type: e.target.value as 'image' })}><option value="image">Image</option><option value="video">Video</option><option value="document">Document</option></Select></Field>
            <Field label="Public file URL" className="col-span-2"><Input value={value.link} placeholder="https://…" onChange={(e) => onChange({ ...value, link: e.target.value })} /></Field>
          </div>
          <Field label="Caption"><Textarea rows={3} value={value.caption ?? ''} onChange={(e) => onChange({ ...value, caption: e.target.value })} /></Field>
        </> : (
          <Field label="Message" hint="Variables: {{name}}, {{first_name}}, {{phone}}, {{email}} or any contact field">
            <Textarea rows={4} value={value.text} maxLength={value.type === 'text' ? 4096 : 1024} onChange={(e) => onChange({ ...value, text: e.target.value })} />
          </Field>
        )}
        {value.type === 'buttons' && <Field label="Buttons (20 chars each)"><StringList value={value.buttons} max={3} maxLen={20} placeholder="Button" onChange={(buttons) => onChange({ ...value, buttons })} /></Field>}
        {value.type === 'list' && <>
          <Field label="Menu button label"><Input maxLength={20} value={value.button} onChange={(e) => onChange({ ...value, button: e.target.value })} /></Field>
          <Field label="Options (24 chars each)"><StringList value={value.items} max={10} maxLen={24} placeholder="Option" onChange={(items) => onChange({ ...value, items })} /></Field>
        </>}
        {value.type === 'cta_url' && <div className="grid grid-cols-2 gap-3">
          <Field label="Button text"><Input maxLength={20} value={value.display_text} onChange={(e) => onChange({ ...value, display_text: e.target.value })} /></Field>
          <Field label="URL"><Input value={value.url} onChange={(e) => onChange({ ...value, url: e.target.value })} /></Field>
        </div>}
      </div>
      {preview && (
        <div className="wa-bg hidden rounded-xl p-4 md:block">
          <p className="mb-3 text-[11px] uppercase tracking-wider text-muted">Preview</p>
          <Bubble body={replyText(value) || 'Your message…'} media={value.type === 'media' ? value.media_type.toUpperCase() : undefined}
            footer={value.type === 'buttons' ? value.footer : undefined}
            buttons={value.type === 'buttons' ? value.buttons.filter(Boolean).map((b) => ({ label: b })) : value.type === 'list' ? [{ label: `☰ ${value.button}` }] : value.type === 'cta_url' ? [{ label: `↗ ${value.display_text}` }] : []} />
        </div>
      )}
    </div>
  )
}
