import { useRef, useState } from 'react'
import { Upload, FileText, X } from 'lucide-react'
import { api } from '../lib/api'
import { Button, useToast } from './ui'

export type Uploaded = { url: string; name: string; mime: string; size: number }

const ACCEPT: Record<string, string> = { IMAGE: 'image/jpeg,image/png', VIDEO: 'video/mp4', DOCUMENT: 'application/pdf', ANY: 'image/*,video/mp4,application/pdf' }

/** Uploads a file to /api/uploads and returns its public URL (used for WhatsApp media and template samples). */
export default function MediaUpload({ kind = 'ANY', value, onChange, label = 'Upload file' }: { kind?: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'ANY'; value?: Uploaded | null; onChange: (u: Uploaded | null) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const t = useToast()
  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-line bg-panel p-2">
        {value.mime.startsWith('image/') ? <img src={value.url} alt="" className="size-12 rounded-lg object-cover" /> : <span className="grid size-12 place-items-center rounded-lg bg-raised"><FileText className="size-5 text-muted" /></span>}
        <div className="min-w-0 flex-1"><div className="truncate text-sm text-white">{value.name}</div><div className="text-xs text-muted">{(value.size / 1024 / 1024).toFixed(2)} MB</div></div>
        <button type="button" onClick={() => onChange(null)} className="p-1 text-muted hover:text-white" aria-label="Remove"><X className="size-4" /></button>
      </div>
    )
  }
  return (
    <>
      <Button type="button" variant="subtle" loading={busy} icon={<Upload className="size-4" />} onClick={() => ref.current?.click()}>{label}</Button>
      <input ref={ref} type="file" hidden accept={ACCEPT[kind]} onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = ''
        if (!f) return
        if (f.size > 16 * 1024 * 1024) return t.err('File is larger than 16 MB')
        const fd = new FormData(); fd.append('file', f)
        setBusy(true)
        try { onChange(await api<Uploaded>('uploads', { method: 'POST', body: fd })) } catch (er) { t.err(er) } finally { setBusy(false) }
      }} />
    </>
  )
}
