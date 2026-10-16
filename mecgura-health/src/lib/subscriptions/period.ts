import { mulDivRound } from "@/lib/billing/money";

const DAY = 86_400_000;
/** Adds whole months in UTC and keeps month-ends sane (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}
export const addInterval = (d: Date, interval: string) => addMonths(d, interval === "YEARLY" ? 12 : 1);
export const addDaysUtc = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const daysBetweenCeil = (from: Date, to: Date) => Math.max(0, Math.ceil((to.getTime() - from.getTime()) / DAY));

/** Mid-period upgrade, charged by the server from a fixed policy: the price DIFFERENCE for the days that are left (whole days, rounded half-up). */
export function prorateUpgrade(o: { oldPriceMinor: number; newPriceMinor: number; periodStart: Date; periodEnd: Date; now: Date }) {
  const total = Math.max(1, daysBetweenCeil(o.periodStart, o.periodEnd)); const remaining = Math.min(total, daysBetweenCeil(o.now, o.periodEnd));
  const credit = mulDivRound(o.oldPriceMinor, remaining, total); const charge = mulDivRound(o.newPriceMinor, remaining, total);
  return { totalDays: total, remainingDays: remaining, creditMinor: credit, chargeMinor: charge, netMinor: Math.max(0, charge - credit) };
}
