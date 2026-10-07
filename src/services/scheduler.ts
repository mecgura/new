import { runDueCampaigns } from "@/services/campaigns/sender";
import { runDueWebhooks } from "@/services/webhooks/delivery";
import { runBillingCycle } from "@/services/billing/billing";
import { purgeOldApiLogs } from "@/services/api/keys";
import { runDueAutomations } from "@/services/automations/engine";

/** One scheduler tick: scheduled campaigns + automation delays, reply timeouts, retries and schedule triggers. */
export async function runScheduledWork(budgetMs = 50_000) {
  const started = Date.now();
  const automations = await runDueAutomations(Math.floor(budgetMs * 0.4));
  const campaigns = await runDueCampaigns(Math.max(5_000, budgetMs - (Date.now() - started)));
  const webhooks = await runDueWebhooks(Math.max(3_000, budgetMs - (Date.now() - started)));
  const apiLogsPurged = await purgeOldApiLogs();
  const billing = await runBillingCycle();
  return { automations, campaigns, webhooks, apiLogsPurged, billing };
}
