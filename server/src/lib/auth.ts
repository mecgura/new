import type { Request, Response, NextFunction } from 'express'
import { get, run, now } from '../db.ts'
import { verifyJwt, sha256 } from './security.ts'
import { HttpError, forbidden } from './http.ts'
import { can, type Permission } from './permissions.ts'
import { hasFeature } from '../services/plans.ts'

export type AuthUser = { id: number; email: string; name: string; is_super_admin: number }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
      ws?: { id: number; role: string; name: string; status: string }
      rawBody?: Buffer
      apiKeyId?: number
    }
  }
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : typeof req.query.token === 'string' ? req.query.token : ''
  const payload = token ? verifyJwt<{ uid: number }>(token) : null
  if (!payload) return next(new HttpError(401, 'Please sign in again', 'unauthenticated'))
  const user = get<AuthUser>('SELECT id, email, name, is_super_admin FROM users WHERE id = ?', payload.uid)
  if (!user) return next(new HttpError(401, 'Account not found', 'unauthenticated'))
  req.user = user
  next()
}

/** Resolves the active workspace from the X-Workspace-Id header and checks membership. */
export function requireWorkspace(req: Request, _res: Response, next: NextFunction) {
  const wsId = Number(req.headers['x-workspace-id'] || req.query.ws)
  if (!wsId) return next(new HttpError(400, 'No workspace selected', 'no_workspace'))
  const ws = get<{ id: number; name: string; status: string }>('SELECT id, name, status FROM workspaces WHERE id = ?', wsId)
  if (!ws) return next(new HttpError(404, 'Workspace not found'))
  const m = get<{ role: string }>('SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?', wsId, req.user!.id)
  if (!m && !req.user!.is_super_admin) return next(forbidden('You are not a member of this workspace'))
  req.ws = { id: ws.id, name: ws.name, status: ws.status, role: m?.role ?? 'owner' }
  if (ws.status === 'suspended' && !req.path.startsWith('/billing') && !req.path.startsWith('/workspace')) {
    return next(new HttpError(403, 'This workspace is suspended. Please contact MECGURA support at hello@mecgura.com.', 'suspended'))
  }
  next()
}

export const perm = (p: Permission) => (req: Request, _res: Response, next: NextFunction) =>
  can(req.ws!.role, p) ? next() : next(forbidden())

export const superAdmin = (req: Request, _res: Response, next: NextFunction) =>
  req.user?.is_super_admin ? next() : next(forbidden('MECGURA admin access only'))

/** Public REST API: `Authorization: Bearer mk_live_...` */
export function requireApiKey(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || ''
  const key = header.startsWith('Bearer ') ? header.slice(7) : String(req.headers['x-api-key'] || '')
  if (!key) return next(new HttpError(401, 'Missing API key'))
  const row = get<{ id: number; workspace_id: number }>('SELECT id, workspace_id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL', sha256(key))
  if (!row) return next(new HttpError(401, 'Invalid API key'))
  const ws = get<{ id: number; name: string; status: string }>('SELECT id, name, status FROM workspaces WHERE id = ?', row.workspace_id)!
  if (ws.status === 'suspended') return next(new HttpError(403, 'Workspace suspended'))
  if (!hasFeature(ws.id, 'api')) return next(new HttpError(402, 'API access is not included in your plan', 'feature_locked'))
  run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', now(), row.id)
  req.ws = { id: ws.id, name: ws.name, status: ws.status, role: 'admin' }
  req.apiKeyId = row.id
  next()
}
