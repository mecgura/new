import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { ZodError, type ZodType } from 'zod'

export class HttpError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) { super(message); this.status = status; this.code = code }
}
export const bad = (msg: string, code?: string) => new HttpError(400, msg, code)
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`)
export const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, msg, 'forbidden')

// Wraps async handlers so thrown errors reach the error middleware.
export const h = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next) }

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data)
  if (!r.success) throw bad(r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '), 'validation')
  return r.data
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  void _next
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code })
  if (err instanceof ZodError) return res.status(400).json({ error: err.message, code: 'validation' })
  console.error(err)
  res.status(500).json({ error: 'Something went wrong. Please try again.' })
}

export const id = (v: unknown) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw bad('Invalid id')
  return n
}

export function paginate(q: Record<string, unknown>) {
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
  const page = Math.max(Number(q.page) || 1, 1)
  return { limit, offset: (page - 1) * limit, page }
}
