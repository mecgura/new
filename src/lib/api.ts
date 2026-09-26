export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) { super(message); this.status = status; this.code = code }
}

const TOKEN_KEY = 'mec.token'
const WS_KEY = 'mec.ws'

function read(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function write(key: string, v: string | null) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, v) } catch { /* storage unavailable */ } }

export const store = {
  get token() { return read(TOKEN_KEY) },
  set token(v: string | null) { write(TOKEN_KEY, v) },
  get ws() { return Number(read(WS_KEY)) || null },
  set ws(v: number | null) { write(WS_KEY, v ? String(v) : null) },
}

let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (store.token) headers.Authorization = `Bearer ${store.token}`
  if (store.ws) headers['X-Workspace-Id'] = String(store.ws)
  let body: BodyInit | undefined
  if (opts.body instanceof FormData) body = opts.body
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body) }
  const res = await fetch(path.startsWith('/') ? path : `/api/${path}`, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers, body })
  if (opts.raw) return res as unknown as T
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized()
    throw new ApiError(res.status, (json as { error?: string }).error || 'Request failed', (json as { code?: string }).code)
  }
  return json as T
}

export const get = <T,>(p: string) => api<T>(p)
export const post = <T,>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body })
export const put = <T,>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body })
export const patch = <T,>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body })
export const del = <T,>(p: string) => api<T>(p, { method: 'DELETE' })

export async function download(path: string, filename: string) {
  const res = await api<Response>(path, { raw: true })
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
