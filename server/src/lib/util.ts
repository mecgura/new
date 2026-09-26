export function normalizePhone(input: string, defaultCc = '91') {
  let d = String(input || '').replace(/[^\d]/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 10) d = defaultCc + d
  if (d.length === 11 && d.startsWith('0')) d = defaultCc + d.slice(1)
  return d
}
export const isValidPhone = (p: string) => /^\d{8,15}$/.test(p)

export function renderVars(text: string, ctx: Record<string, unknown>) {
  return String(text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), ctx)
    return v === undefined || v === null ? '' : String(v)
  })
}

export const period = (d = new Date()) => d.toISOString().slice(0, 7)
export const addMinutes = (m: number, from = new Date()) => new Date(from.getTime() + m * 60000).toISOString()
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let cur: string[] = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') q = false; else field += c
    } else if (c === '"') q = true
    else if (c === ',') { cur.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      cur.push(field); field = ''
      if (cur.some((x) => x.trim())) rows.push(cur)
      cur = []
    } else field += c
  }
  cur.push(field)
  if (cur.some((x) => x.trim())) rows.push(cur)
  const [head, ...body] = rows
  if (!head) return []
  const keys = head.map((k) => k.trim().toLowerCase())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return ''
  const keys = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n')
}
