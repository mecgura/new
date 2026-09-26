import type { Response } from 'express'

// In-process realtime bus for the dashboard (Server-Sent Events), keyed by workspace.
const clients = new Map<number, Set<Response>>()

export function subscribe(workspaceId: number, res: Response) {
  if (!clients.has(workspaceId)) clients.set(workspaceId, new Set())
  clients.get(workspaceId)!.add(res)
  return () => clients.get(workspaceId)?.delete(res)
}

export function publish(workspaceId: number, type: string, data: unknown) {
  const set = clients.get(workspaceId)
  if (!set) return
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of set) res.write(msg)
}

setInterval(() => { for (const set of clients.values()) for (const res of set) res.write(': ping\n\n') }, 25000).unref()
