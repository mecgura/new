import "server-only";
import { z } from "zod";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { RANGE_PRESETS, RangeError_, resolveRange, type ResolvedRange } from "@/lib/analytics/range";
import { todayIn } from "@/lib/scheduling/time";
import type { Permission } from "@/lib/permissions";
import { db as rawDb } from "@/lib/db";
import { tenantDb } from "@/lib/tenant/db";
import { tenantTimezone, type Client } from "./clinic-shared";

/**
 * Shared plumbing for every analytics domain. Rules enforced here, once:
 *  - the tenant comes from the SESSION (ctx), never from the request; doctorId from the request is validated against this clinic
 *  - a DOCTOR can only ever see their own data (forced server-side, whatever the request says)
 *  - every domain needs analytics.view PLUS its own domain permission
 *  - results are cached per tenant + range + filters + scope + permission signature (short TTL), and carry a "generated at" time
 */
export const db = (ctx: TenantRequestContext) => tenantDb(ctx) as Client;

export const DOMAIN_PERMISSION = {
  patients: "analytics.patients", operations: "analytics.operations", clinical: "analytics.clinical", financial: "analytics.financial",
  lab: "analytics.lab", pharmacy: "analytics.pharmacy", communication: "analytics.communication",
} as const satisfies Record<string, Permission>;
export type Domain = keyof typeof DOMAIN_PERMISSION;

export const querySchema = z.object({
  preset: z.enum(RANGE_PRESETS).optional(),
  from: z.string().max(10).optional(), to: z.string().max(10).optional(),
  compare: z.union([z.boolean(), z.enum(["1", "true", "0", "false"])]).optional().transform((v) => v === true || v === "1" || v === "true"),
  doctorId: z.string().max(40).optional(),
  status: z.string().max(40).optional(), type: z.string().max(40).optional(), channel: z.string().max(20).optional(),
  refresh: z.union([z.boolean(), z.enum(["1", "true", "0", "false"])]).optional().transform((v) => v === true || v === "1" || v === "true"),
});
export type AnalyticsQuery = z.input<typeof querySchema>;
export type ParsedQuery = z.output<typeof querySchema>;

export function parseQuery(raw: unknown): ParsedQuery {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) if (v !== "" && v !== undefined && v !== null) clean[k] = Array.isArray(v) ? v[0] : v;
  const r = querySchema.safeParse(clean);
  if (!r.success) throw new AppError("VALIDATION_ERROR", { message: "Check the report filters and try again." });
  return r.data;
}
export const queryFromSearchParams = (sp: URLSearchParams) => parseQuery(Object.fromEntries(sp.entries()));

export function requireAnalytics(ctx: TenantRequestContext, ...needed: Permission[]) {
  if (!ctx.permissions.has("analytics.view")) throw new AppError("FORBIDDEN", { message: "You don't have access to analytics." });
  for (const p of needed) if (!ctx.permissions.has(p)) throw new AppError("FORBIDDEN", { message: "You don't have access to this analytics section." });
}
export const canDomain = (ctx: TenantRequestContext, d: Domain) => ctx.permissions.has("analytics.view") && ctx.permissions.has(DOMAIN_PERMISSION[d]);
export const isDoctorScoped = (ctx: TenantRequestContext) => ctx.user.role === "DOCTOR";

export interface Env { ctx: TenantRequestContext; tdb: Client; tz: string; today: string; range: ResolvedRange; doctorId: string | null; own: boolean; q: ParsedQuery; currency?: string; localize: (d: Date) => { date: string; hour: number; weekday: number } }

/** Fast local-time bucketing (one formatter, memoised per minute). */
export function makeLocalizer(tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const memo = new Map<number, { date: string; hour: number; weekday: number }>();
  return (d: Date) => {
    const k = Math.floor(d.getTime() / 60000); const hit = memo.get(k); if (hit) return hit;
    const p: Record<string, string> = {}; for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
    const v = { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: WD[p.weekday] ?? 0 };
    if (memo.size > 50000) memo.clear(); memo.set(k, v); return v;
  };
}

export async function buildEnv(ctx: TenantRequestContext, rawQuery: unknown): Promise<Env> {
  const q = parseQuery(rawQuery);
  const tz = await tenantTimezone(ctx.tenantId); const today = todayIn(tz);
  let range: ResolvedRange;
  try { range = resolveRange({ preset: q.preset, from: q.from, to: q.to, compare: q.compare }, tz, today); }
  catch (e) { if (e instanceof RangeError_) throw new AppError("VALIDATION_ERROR", { message: e.message, fieldErrors: { from: e.message } }); throw e; }
  const tdb = db(ctx);
  let doctorId: string | null = null; const own = isDoctorScoped(ctx);
  if (own) doctorId = ctx.user.id;
  else if (q.doctorId) {
    const d = await tdb.user.findFirst({ where: { id: q.doctorId, role: { key: "DOCTOR" } }, select: { id: true } });
    if (!d) throw new AppError("VALIDATION_ERROR", { message: "Choose a doctor from this clinic.", fieldErrors: { doctorId: "Choose a doctor from this clinic." } });
    doctorId = d.id;
  }
  return { ctx, tdb, tz, today, range, doctorId, own, q, localize: makeLocalizer(tz) };
}

/* ------------------------------------------------------------ cache ------------------------------------------------------------ */
const store = new Map<string, { exp: number; value: unknown }>();
const ttl = () => { const v = Number(process.env.ANALYTICS_CACHE_TTL_MS); return Number.isFinite(v) && v >= 0 ? v : 60_000; };
export function clearAnalyticsCache(tenantId?: string) { for (const k of [...store.keys()]) if (!tenantId || k.startsWith(`${tenantId}|`)) store.delete(k); }
const SIG_PERMS: Permission[] = ["analytics.view", "analytics.patients", "analytics.operations", "analytics.clinical", "analytics.financial", "analytics.lab", "analytics.pharmacy", "analytics.communication", "patients.identity", "billing.discount", "billing.reports", "reports.export_patient"];

export interface Meta { domain: string; range: { preset: string; label: string; from: string; to: string; days: number }; previous: { from: string; to: string } | null; timezone: string; scope: { doctorId: string | null; own: boolean }; generatedAt: string; cached: boolean }
export type Result<T> = T & { meta: Meta };

/** Runs one analytics domain through guard -> env -> cache -> (audit). `compute` receives a fully validated Env. */
export async function runDomain<T extends object>(ctx: TenantRequestContext, rawQuery: unknown, domain: string, perms: Permission[], compute: (env: Env) => Promise<T>, opts: { audit?: boolean; extraKey?: string } = {}): Promise<Result<T>> {
  requireAnalytics(ctx, ...perms);
  const env = await buildEnv(ctx, rawQuery);
  const sig = SIG_PERMS.filter((p) => ctx.permissions.has(p)).join(",");
  const key = [ctx.tenantId, domain, env.range.from, env.range.to, env.q.compare ? "c" : "n", env.doctorId ?? "-", ctx.user.role, env.own ? ctx.user.id : "", sig, env.q.status ?? "", env.q.type ?? "", env.q.channel ?? "", opts.extraKey ?? ""].join("|");
  const now = Date.now(); const hit = store.get(key);
  let body: T; let generatedAt: string; let cached = false;
  if (hit && hit.exp > now && !env.q.refresh) { const v = hit.value as { body: T; generatedAt: string }; body = v.body; generatedAt = v.generatedAt; cached = true; }
  else {
    body = await compute(env); generatedAt = new Date().toISOString();
    if (ttl() > 0) { if (store.size > 500) store.clear(); store.set(key, { exp: now + ttl(), value: { body, generatedAt } }); }
  }
  if (opts.audit) await recordAudit({ action: AUDIT_ACTIONS.ANALYTICS_VIEWED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "analytics", entityId: domain, metadata: { domain, from: env.range.from, to: env.range.to, doctorScoped: !!env.doctorId } });
  const meta: Meta = { domain, range: { preset: env.range.preset, label: env.range.label, from: env.range.from, to: env.range.to, days: env.range.days }, previous: env.range.previous ? { from: env.range.previous.from, to: env.range.previous.to } : null, timezone: env.tz, scope: { doctorId: env.doctorId, own: env.own }, generatedAt, cached };
  return { ...body, meta };
}

/** Whether the clinic had any history before the previous period started (otherwise comparisons are "insufficient history"). */
export async function insufficientHistory(env: Env): Promise<boolean> {
  if (!env.range.previous) return false;
  const t = await rawDb.tenant.findFirst({ where: { id: env.ctx.tenantId }, select: { createdAt: true } });
  return !!t && t.createdAt > env.range.previous.end;
}

export const doctorWhere = (env: Env, field = "doctorUserId") => (env.doctorId ? { [field]: env.doctorId } : {});
export const ROW_CAP = 100_000;
export const majorString = (minor: number) => `${minor < 0 ? "-" : ""}${Math.floor(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, "0")}`;
export async function currencyOf(env: Env): Promise<string> {
  const s = await env.tdb.billingSettings.findFirst({ where: {}, select: { currency: true } });
  return s?.currency ?? "INR";
}
export async function doctorNames(env: Env, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = u.length ? await env.tdb.user.findMany({ where: { id: { in: u } }, select: { id: true, name: true } }) : [];
  return new Map(rows.map((r: { id: string; name: string }) => [r.id, r.name]));
}

/** Drill-down link into the Report Center with the exact range and filters of the widget. */
export function drill(env: Env, report: string, extra: Record<string, string> = {}) {
  return `/analytics/reports/${report}?${new URLSearchParams({ preset: "custom", from: env.range.from, to: env.range.to, ...(env.doctorId && !env.own ? { doctorId: env.doctorId } : {}), ...extra })}`;
}
export const chunk = <T,>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
export const BILLED = ["ISSUED", "PARTIALLY_PAID", "PAID", "REFUNDED", "PARTIALLY_REFUNDED"];
export const MONEY_IN = ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"];
/** SQLite (dev/test) caps bound parameters; chunked IN lists keep every query valid on both engines. */
export const IN_CHUNK = 500;
