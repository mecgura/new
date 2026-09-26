import { processCampaigns } from './campaigns.ts'
import { resumeSleepingRuns, processSequences } from './automation.ts'
import { deliverPending } from './hooks.ts'
import { enforceSubscriptions, backupDatabase } from './subscription.ts'

let busy = false
let lastHourly = 0

async function tick() {
  if (busy) return
  busy = true
  try {
    if (Date.now() - lastHourly > 3600000) {
      lastHourly = Date.now()
      enforceSubscriptions()
      try { backupDatabase() } catch (e) { console.error('backup failed', e) }
    }
    await processCampaigns()
    await resumeSleepingRuns()
    await processSequences()
    await deliverPending()
  } catch (e) { console.error('worker tick failed', e) } finally { busy = false }
}

export function startWorker(intervalMs = Number(process.env.WORKER_INTERVAL_MS) || 4000) {
  setInterval(tick, intervalMs).unref()
}
