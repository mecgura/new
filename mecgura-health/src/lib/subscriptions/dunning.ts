import type { SubscriptionPolicy } from "./state";
const DAY = 86_400_000;
/** What should happen to a subscription whose collectible invoice is due at `dueAt`, at time `now`. Pure so the schedule is testable. */
export type DunningStep = "NONE" | "REMINDER" | "OVERDUE" | "GRACE" | "GRACE_ENDING" | "SUSPEND";
export function dunningStep(o: { status: string; dueAt: Date; now: Date; graceStart: Date | null; policy: SubscriptionPolicy }): DunningStep {
  const { status, dueAt, now, graceStart, policy } = o; const sinceDue = (now.getTime() - dueAt.getTime()) / DAY;
  if (status === "ACTIVE" || status === "TRIAL") return sinceDue >= 0 ? "OVERDUE" : sinceDue > -3 ? "REMINDER" : "NONE";
  if (status === "PAST_DUE") return sinceDue >= policy.dunningDays ? "GRACE" : "NONE";
  if (status === "GRACE") {
    const start = graceStart ?? now; const left = policy.graceDays - (now.getTime() - start.getTime()) / DAY;
    return left <= 0 ? "SUSPEND" : left <= 1 ? "GRACE_ENDING" : "NONE";
  }
  return "NONE";
}
