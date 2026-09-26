import { useCallback, useEffect, useRef, useState } from 'react'
import { api, store } from './api'

/** Fetch JSON from the API with loading/error state and a reload() helper. Refetches when `path` changes. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; path: string | null }>({ data: null, error: null, path: null })
  const latest = useRef(path)
  useEffect(() => { latest.current = path })

  const fetchInto = useCallback(async (p: string) => {
    try {
      const d = await api<T>(p)
      if (latest.current === p) setState({ data: d, error: null, path: p })
    } catch (e) {
      if (latest.current === p) setState((s) => ({ ...s, error: (e as Error).message, path: p }))
    }
  }, [])

  useEffect(() => { if (path) void fetchInto(path) }, [path, fetchInto])

  const reload = useCallback(async () => { if (latest.current) await fetchInto(latest.current) }, [fetchInto])
  const setData = useCallback((fn: T | null | ((d: T | null) => T | null)) => {
    setState((s) => ({ ...s, data: typeof fn === 'function' ? (fn as (d: T | null) => T | null)(s.data) : fn }))
  }, [])
  return { data: state.data, setData, error: state.error, loading: !!path && state.path !== path, reload }
}

type Handler = (type: string, data: unknown) => void
const handlers = new Set<Handler>()
let source: EventSource | null = null
let sourceKey = ''

function ensureSource() {
  const key = `${store.token}|${store.ws}`
  if (source && sourceKey === key) return
  source?.close()
  if (!store.token || !store.ws) return
  sourceKey = key
  source = new EventSource(`/api/events?token=${encodeURIComponent(store.token)}&ws=${store.ws}`)
  for (const t of ['message', 'status', 'conversation', 'notification', 'campaign', 'contact']) {
    source.addEventListener(t, (e) => { const d = JSON.parse((e as MessageEvent).data); handlers.forEach((h) => h(t, d)) })
  }
}

/** Subscribe to realtime workspace events (Server-Sent Events). */
export function useEvents(fn: Handler) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })
  useEffect(() => {
    ensureSource()
    const h: Handler = (t, d) => ref.current(t, d)
    handlers.add(h)
    return () => { handlers.delete(h) }
  }, [])
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/** Current time that re-renders every `ms` — keeps render pure for countdowns. */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}
