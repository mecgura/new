import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, store, setUnauthorizedHandler } from './api'

export type Workspace = { id: number; name: string; role: string; status: string; plan: string; permissions: string[]; subscription_status: string; trial_ends_at: string | null; current_period_end: string | null; via_admin?: boolean }
export type User = { id: number; email: string; name: string; phone: string | null; is_super_admin: number }
type SessionData = { user: User; workspaces: Workspace[] }

type Ctx = {
  user: User | null
  workspaces: Workspace[]
  ws: Workspace | null
  loading: boolean
  can: (perm: string) => boolean
  setSession: (d: SessionData & { token?: string }) => void
  switchWorkspace: (id: number) => void
  refresh: () => Promise<void>
  logout: () => void
}

const SessionCtx = createContext<Ctx | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<SessionData | null>(null)
  const [wsId, setWsId] = useState<number | null>(store.ws)
  const [loading, setLoading] = useState(!!store.token)

  const logout = useCallback(() => { store.token = null; store.ws = null; setData(null); setWsId(null) }, [])
  useEffect(() => setUnauthorizedHandler(logout), [logout])

  const setSession = useCallback((d: SessionData & { token?: string }) => {
    if (d.token) store.token = d.token
    setData({ user: d.user, workspaces: d.workspaces })
    setWsId((cur) => {
      const next = d.workspaces.find((w) => w.id === cur)?.id ?? d.workspaces[0]?.id ?? null
      store.ws = next
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!store.token) return
    try { setSession(await api<SessionData>('/api/auth/me')) } catch { /* handled by 401 handler */ } finally { setLoading(false) }
  }, [setSession])

  useEffect(() => {
    if (!store.token) return
    api<SessionData>('/api/auth/me').then(setSession).catch(() => undefined).finally(() => setLoading(false))
  }, [setSession])

  const value = useMemo<Ctx>(() => {
    const ws = data?.workspaces.find((w) => w.id === wsId) ?? null
    return {
      user: data?.user ?? null, workspaces: data?.workspaces ?? [], ws, loading,
      can: (p) => !!ws?.permissions.includes(p),
      setSession, refresh, logout,
      switchWorkspace: (id) => { store.ws = id; setWsId(id); window.location.assign('/app') },
    }
  }, [data, wsId, loading, setSession, refresh, logout])

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSession() {
  const c = useContext(SessionCtx)
  if (!c) throw new Error('useSession outside provider')
  return c
}
