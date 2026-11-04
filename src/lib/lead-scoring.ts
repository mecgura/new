// Lead scoring: configurable points per signal, summed and capped at 100, then Hot / Warm / Cold by thresholds.
// Pure module (no DB) so the contacts list, deals board, settings preview and tests share it.
import { z } from "zod";

export const SCORE_SIGNALS = ["tag", "lead_status", "source", "opted_in", "has_email", "replied_within_days", "open_deal_value"] as const;
export type ScoreSignal = (typeof SCORE_SIGNALS)[number];

export const SIGNAL_LABELS: Record<ScoreSignal, string> = {
  tag: "Has tag",
  lead_status: "Lead status is",
  source: "Came from",
  opted_in: "Opted in to WhatsApp",
  has_email: "Has an email",
  replied_within_days: "Messaged us in the last … days",
  open_deal_value: "Open deal worth at least ₹",
};

export const ruleSchema = z
  .object({
    signal: z.enum(SCORE_SIGNALS),
    value: z.string().trim().max(60).default(""),
    points: z.coerce.number().int().min(-100).max(100),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (["tag", "lead_status", "source"].includes(r.signal) && !r.value) ctx.addIssue({ code: "custom", message: "Enter a value", path: ["value"] });
    if (["replied_within_days", "open_deal_value"].includes(r.signal) && !(Number(r.value) > 0)) ctx.addIssue({ code: "custom", message: "Enter a number above 0", path: ["value"] });
  });
export type ScoreRule = z.infer<typeof ruleSchema>;

export const scoringSchema = z
  .object({
    rules: z.array(ruleSchema).max(30),
    hot: z.coerce.number().int().min(1).max(100),
    warm: z.coerce.number().int().min(0).max(99),
  })
  .strict()
  .refine((v) => v.warm < v.hot, { message: "Warm must be below Hot", path: ["warm"] });
export type ScoringConfig = z.infer<typeof scoringSchema>;

export const DEFAULT_SCORING: ScoringConfig = {
  rules: [
    { signal: "replied_within_days", value: "3", points: 30 },
    { signal: "lead_status", value: "qualified", points: 20 },
    { signal: "lead_status", value: "proposal", points: 30 },
    { signal: "opted_in", value: "", points: 10 },
    { signal: "has_email", value: "", points: 5 },
    { signal: "tag", value: "Hot lead", points: 25 },
    { signal: "open_deal_value", value: "10000", points: 15 },
  ],
  hot: 60,
  warm: 30,
};

export function parseScoring(raw: string | null | undefined): ScoringConfig {
  if (!raw) return DEFAULT_SCORING;
  try {
    const p = scoringSchema.safeParse(JSON.parse(raw));
    return p.success ? p.data : DEFAULT_SCORING;
  } catch {
    return DEFAULT_SCORING;
  }
}

export type ScoreInput = {
  tags: string[];
  leadStatus: string;
  source: string;
  optInStatus: string;
  email: string;
  lastInboundAt: Date | null;
  openDealPaise: number;
};

export type Heat = "hot" | "warm" | "cold";
export type ScoreResult = { score: number; heat: Heat; reasons: string[] };

function reasonText(r: ScoreRule) {
  switch (r.signal) {
    case "tag":
      return `tag “${r.value}”`;
    case "lead_status":
      return `status ${r.value}`;
    case "source":
      return `came from ${r.value}`;
    case "opted_in":
      return "opted in to WhatsApp";
    case "has_email":
      return "has an email";
    case "replied_within_days":
      return `messaged in the last ${r.value} day${r.value === "1" ? "" : "s"}`;
    case "open_deal_value":
      return `open deal of ₹${Number(r.value).toLocaleString("en-IN")}+`;
  }
}

export function scoreContact(c: ScoreInput, cfg: ScoringConfig, now = Date.now()): ScoreResult {
  let total = 0;
  const reasons: string[] = [];
  const tags = new Set(c.tags.map((t) => t.toLowerCase()));
  for (const r of cfg.rules) {
    let hit = false;
    switch (r.signal) {
      case "tag":
        hit = tags.has(r.value.toLowerCase());
        break;
      case "lead_status":
        hit = c.leadStatus === r.value;
        break;
      case "source":
        hit = c.source === r.value;
        break;
      case "opted_in":
        hit = c.optInStatus === "opted_in";
        break;
      case "has_email":
        hit = Boolean(c.email);
        break;
      case "replied_within_days":
        hit = Boolean(c.lastInboundAt && now - c.lastInboundAt.getTime() <= Number(r.value) * 86_400_000);
        break;
      case "open_deal_value":
        hit = c.openDealPaise >= Number(r.value) * 100;
        break;
    }
    if (hit) {
      total += r.points;
      reasons.push(`${r.points > 0 ? "+" : ""}${r.points} ${reasonText(r)}`);
    }
  }
  const score = Math.max(0, Math.min(100, total));
  return { score, heat: score >= cfg.hot ? "hot" : score >= cfg.warm ? "warm" : "cold", reasons };
}
