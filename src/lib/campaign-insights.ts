// Campaign intelligence helpers. Pure module (no DB): A/B variant assignment, a two-proportion significance test,
// and plain-language explanations for WhatsApp delivery errors.
import { createHash } from "node:crypto";

export const AB_SPLITS = [10, 20, 30, 40, 50] as const;

/** Stable A/B arm for a recipient: the same campaign + phone always lands in the same arm. */
export function assignVariant(campaignId: string, phone: string, splitPct: number): "A" | "B" {
  if (splitPct <= 0) return "A";
  const h = createHash("sha256").update(`${campaignId}:${phone}`).digest();
  return h.readUInt32BE(0) % 100 < splitPct ? "B" : "A";
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function phi(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export type AbVerdict = { metric: string; rateA: number; rateB: number; pValue: number | null; winner: "A" | "B" | null; confident: boolean; note: string };

/**
 * Two-proportion z-test. A winner is only called with at least `minEach` people per arm and p < 0.05; otherwise the
 * leader is shown as "not enough data yet" so nobody acts on noise.
 */
export function compare(metric: string, successA: number, nA: number, successB: number, nB: number, minEach = 100): AbVerdict {
  const rateA = nA ? successA / nA : 0;
  const rateB = nB ? successB / nB : 0;
  const pct = (r: number) => Math.round(r * 1000) / 10;
  if (!nA || !nB) return { metric, rateA: pct(rateA), rateB: pct(rateB), pValue: null, winner: null, confident: false, note: "Waiting for results from both versions." };
  const pool = (successA + successB) / (nA + nB);
  const se = Math.sqrt(pool * (1 - pool) * (1 / nA + 1 / nB));
  const z = se ? (rateB - rateA) / se : 0;
  const pValue = se ? 2 * (1 - phi(Math.abs(z))) : 1;
  const leader = rateA === rateB ? null : rateB > rateA ? "B" : "A";
  const confident = Boolean(leader) && nA >= minEach && nB >= minEach && pValue < 0.05;
  const note = !leader
    ? "Both versions perform the same so far."
    : confident
      ? `Version ${leader} wins on ${metric} (${pct(leader === "B" ? rateB : rateA)}% vs ${pct(leader === "B" ? rateA : rateB)}%), unlikely to be chance.`
      : nA < minEach || nB < minEach
        ? `Version ${leader} leads, but each version needs at least ${minEach} people before calling a winner.`
        : `Version ${leader} leads, but the difference could still be chance.`;
  return { metric, rateA: pct(rateA), rateB: pct(rateB), pValue: Math.round(pValue * 1000) / 1000, winner: confident ? leader : null, confident, note };
}

/** What a WhatsApp/Meta delivery error means and what to do, keyed by Meta error code or a text match. */
const HINTS: { match: RegExp; title: string; fix: string }[] = [
  { match: /131026|undeliverable/i, title: "Not on WhatsApp or can't receive", fix: "The number may not use WhatsApp, has an old app version, or hasn't accepted the latest terms. Remove it or reach them another way." },
  { match: /131049|healthy ecosystem|marketing message/i, title: "Meta limited marketing messages to this person", fix: "Meta caps how many marketing messages one person gets from all businesses. Try again in a few days, or send fewer, more relevant campaigns." },
  { match: /131047|re-engagement|24 hours/i, title: "24-hour window closed", fix: "Only approved templates can reach people who haven't messaged in 24 hours." },
  { match: /131050|stopped|opted out of marketing/i, title: "Person stopped marketing messages", fix: "They chose to stop marketing messages from you in WhatsApp. Mark them opted out." },
  { match: /131056|pair rate/i, title: "Too many messages to the same person", fix: "Slow down messages to one number; wait before sending again." },
  { match: /131048|spam rate/i, title: "Blocked for spam rate", fix: "Too many people blocked or reported recent messages. Pause campaigns, improve targeting and content." },
  { match: /132000|132001|132005|132007|132012|132015|132016|template/i, title: "Template problem", fix: "The template is missing, paused, disabled or its variables don't match. Check the template in Templates." },
  { match: /131042|payment|billing|credit line/i, title: "Payment issue on the WhatsApp account", fix: "Meta can't charge the WhatsApp account. Fix the payment method or credit line in Meta Business Manager." },
  { match: /130472|experiment/i, title: "Held back by a Meta experiment", fix: "Meta is testing marketing message delivery; nothing to fix." },
  { match: /131031|account.*(locked|restricted)|disabled/i, title: "WhatsApp account restricted", fix: "Meta restricted the account. Check Business Manager → Account quality." },
  { match: /wallet|balance/i, title: "Wallet ran out", fix: "Add wallet credit, then resume the campaign." },
  { match: /opt(ed)?[- ]?(in|out)|consent|suppress/i, title: "Consent changed before sending", fix: "Skipped automatically because consent changed. Nothing to fix." },
  { match: /interrupted/i, title: "Sending was interrupted", fix: "Not retried to avoid duplicates. Send a follow-up campaign to these people if needed." },
];

export function explainError(error: string): { title: string; fix: string } {
  const h = HINTS.find((x) => x.match.test(error));
  return h ? { title: h.title, fix: h.fix } : { title: "Other error", fix: "Check the exact message from Meta; contact MECGURA support if it repeats." };
}
