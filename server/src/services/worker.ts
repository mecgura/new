import { processCampaigns } from './campaigns.ts'
import { resumeSleepingRuns, processSequences } from './automation.ts'
import { deliverPending } from './hooks.ts'

let busy = false
async function tick() {
  if (busy) return
  busy = true
  try {
    await processCampaigns()
    await resumeSleepingRuns()
    await processSequences()
    await deliverPending()
  } catch (e) { console.error('worker tick failed', e) } finally { busy = false }
}

export function startWorker(intervalMs = 4000) {
  setInterval(tick, intervalMs).unref()
}
