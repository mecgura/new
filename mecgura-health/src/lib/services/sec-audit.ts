import "server-only";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, auditCanonical, recordAudit } from "@/lib/audit";
import type { RequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { hmacHex, safeEqualStr, sha256Hex } from "@/lib/security/crypto";
import { guard, requireReason, stepUp } from "./platform-core";
import { securityEvent } from "./sec-events";
import { getSecurityPolicy } from "./sec-policy";

/*
 * Audit integrity. Each audit row carries an HMAC of its own content (see recordAudit). A SEAL then pins a range: how many hashed rows it holds and a
 * rolling hash over their hashes, signed together with the previous seal's signature. So:
 *   - editing a row  → its own HMAC no longer matches            (caught by row verification)
 *   - deleting rows  → the seal's count / rolling hash no longer matches (caught by seal verification)
 *   - rewriting a whole range → needs the signing key, which is not in the database
 * The database also refuses UPDATE on audit rows (trigger in the migration). Deletion is possible only through retention purge, which records a signed PURGE seal.
 */
const MARGIN_MS = 60_000;
const sealData = (s: { fromAt: Date; toAt: Date; count: number; chainHash: string }, prevHmac: string) => `${s.fromAt.toISOString()}|${s.toAt.toISOString()}|${s.count}|${s.chainHash}|${prevHmac}`;
async function rangeChain(fromExclusive: Date | null, to: Date) {
  const where = { hash: { not: null }, createdAt: { ...(fromExclusive ? { gt: fromExclusive } : {}), lte: to } };
  let count = 0, chain = ""; let cursor: { createdAt: Date; id: string } | null = null;
  for (;;) {
    const rows: { id: string; hash: string | null; createdAt: Date }[] = await db.auditLog.findMany({ where: cursor ? { AND: [where, { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }] } : where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 2000, select: { id: true, hash: true, createdAt: true } });
    if (!rows.length) break; for (const r of rows) { chain = sha256Hex(chain + r.hash); count++; } cursor = { createdAt: rows[rows.length - 1].createdAt, id: rows[rows.length - 1].id }; if (rows.length < 2000) break;
  }
  return { count, chain };
}
const lastSeal = () => db.auditSeal.findFirst({ where: { NOT: { chainHash: { startsWith: "PURGE:" } } }, orderBy: { toAt: "desc" } });

export async function sealAudit(ctx: RequestContext | null, now = new Date()) {
  if (ctx) guard(ctx);
  const prev = await lastSeal(); const to = new Date(now.getTime() - MARGIN_MS); if (prev && to <= prev.toAt) return { sealed: false as const, reason: "nothing new" };
  const from = prev?.toAt ?? null; const { count, chain } = await rangeChain(from, to); if (count === 0) return { sealed: false as const, reason: "no signed rows" };
  const base = { fromAt: from ?? new Date(0), toAt: to, count, chainHash: chain }; const sig = hmacHex("audit-seal", sealData(base, prev?.hmac ?? ""));
  const seal = await db.auditSeal.create({ data: { ...base, hmac: sig.hmac, keyId: sig.keyId, sealedById: ctx?.user.id ?? null } });
  await recordAudit({ action: AUDIT_ACTIONS.SECURITY_AUDIT_SEALED, tenantId: null, actorId: ctx?.user.id, entityType: "audit_seal", entityId: seal.id, metadata: { count } });
  return { sealed: true as const, sealId: seal.id, count };
}

export interface AuditVerification { ok: boolean; rowsChecked: number; unsigned: number; tampered: { id: string; action: string; at: Date }[]; seals: { id: string; toAt: Date; count: number; status: "OK" | "PURGED" | "BROKEN"; reason?: string }[]; verifiedAt: Date }
/** Re-computes row signatures (newest `limit` rows) and every seal. Read-only. */
export async function verifyAudit(ctx: RequestContext, limit = 5000): Promise<AuditVerification> {
  guard(ctx); const cap = Math.min(20000, Math.max(100, limit));
  const rows = await db.auditLog.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: cap });
  const tampered: AuditVerification["tampered"] = []; let unsigned = 0;
  for (const r of rows) {
    if (!r.hash || !r.hashKeyId) { unsigned++; continue; }
    let ok = false; try { ok = safeEqualStr(hmacHex("audit", auditCanonical(r), r.hashKeyId).hmac, r.hash); } catch { ok = false; }
    if (!ok) tampered.push({ id: r.id, action: r.action, at: r.createdAt });
  }
  const seals = await db.auditSeal.findMany({ orderBy: { toAt: "asc" } }); const purges = seals.filter((s) => s.chainHash.startsWith("PURGE:")); const out: AuditVerification["seals"] = []; let prevHmac = "";
  for (const s of seals.filter((x) => !x.chainHash.startsWith("PURGE:"))) {
    let sigOk = false; try { sigOk = safeEqualStr(hmacHex("audit-seal", sealData(s, prevHmac), s.keyId).hmac, s.hmac); } catch { sigOk = false; }
    prevHmac = s.hmac;
    if (!sigOk) { out.push({ id: s.id, toAt: s.toAt, count: s.count, status: "BROKEN", reason: "seal signature mismatch" }); continue; }
    if (purges.some((p) => p.createdAt > s.createdAt && p.fromAt <= s.toAt && p.toAt >= s.fromAt)) { out.push({ id: s.id, toAt: s.toAt, count: s.count, status: "PURGED" }); continue; }
    const cur = await rangeChain(s.fromAt.getTime() === 0 ? null : s.fromAt, s.toAt);
    out.push(cur.count === s.count && cur.chain === s.chainHash ? { id: s.id, toAt: s.toAt, count: s.count, status: "OK" } : { id: s.id, toAt: s.toAt, count: s.count, status: "BROKEN", reason: `expected ${s.count} rows, found ${cur.count}` });
  }
  const ok = tampered.length === 0 && out.every((s) => s.status !== "BROKEN"); const res: AuditVerification = { ok, rowsChecked: rows.length, unsigned, tampered: tampered.slice(0, 50), seals: out.slice(-50), verifiedAt: new Date() };
  await recordAudit({ action: AUDIT_ACTIONS.SECURITY_AUDIT_VERIFIED, tenantId: null, actorId: ctx.user.id, metadata: { ok, rowsChecked: rows.length, tampered: tampered.length, brokenSeals: out.filter((s) => s.status === "BROKEN").length } });
  if (!ok) await securityEvent({ severity: "CRITICAL", category: "INTEGRITY", type: "AUDIT_INTEGRITY_FAILED", summary: `Audit verification found ${tampered.length} altered row(s) and ${out.filter((s) => s.status === "BROKEN").length} broken seal(s)`, actorId: ctx.user.id });
  return res;
}

/* ---------------------------------------------------------------- legal holds ---------------------------------------------------------------- */
export async function placeLegalHold(ctx: RequestContext, i: { scopeType?: string; scopeId?: string; tenantId?: string; reason?: string }) {
  const isSA = ctx.user.role === "SUPER_ADMIN"; const scopeType = i.scopeType;
  if (!["TENANT", "PATIENT", "AUDIT"].includes(scopeType ?? "")) throw new AppError("VALIDATION_ERROR", { message: "Choose what the hold covers." });
  let tenantId: string | null = null;
  if (isSA) { guard(ctx); tenantId = i.tenantId ?? null; if (scopeType !== "AUDIT" && !tenantId) throw new AppError("VALIDATION_ERROR", { message: "Choose the clinic." }); }
  else { if (!ctx.tenant || !ctx.permissions.has("privacy.manage") || scopeType !== "PATIENT") throw new AppError("FORBIDDEN"); tenantId = ctx.tenant.id; }
  if (scopeType === "PATIENT") { if (!i.scopeId || !(await db.patient.findFirst({ where: { id: i.scopeId, tenantId: tenantId! }, select: { id: true } }))) throw new AppError("NOT_FOUND", { message: "That patient doesn't exist." }); }
  const reason = requireReason(i.reason, 10);
  const hold = await db.legalHold.create({ data: { tenantId, scopeType: scopeType!, scopeId: i.scopeId ?? null, reason, placedById: ctx.user.id } });
  await recordAudit({ action: AUDIT_ACTIONS.SECURITY_LEGAL_HOLD_CHANGED, tenantId, actorId: ctx.user.id, entityType: "legal_hold", entityId: hold.id, reason, metadata: { placed: true, scopeType } });
  return hold;
}
export async function releaseLegalHold(ctx: RequestContext, id: string, note: unknown) {
  const h = await db.legalHold.findUnique({ where: { id } }); if (!h || h.releasedAt) throw new AppError("NOT_FOUND", { message: "That hold doesn't exist or is already released." });
  if (ctx.user.role === "SUPER_ADMIN") guard(ctx); else if (!ctx.tenant || h.tenantId !== ctx.tenant.id || !ctx.permissions.has("privacy.manage")) throw new AppError("NOT_FOUND");
  const reason = requireReason(note, 10); await db.legalHold.update({ where: { id }, data: { releasedAt: new Date(), releasedById: ctx.user.id, releaseNote: reason } });
  await recordAudit({ action: AUDIT_ACTIONS.SECURITY_LEGAL_HOLD_CHANGED, tenantId: h.tenantId, actorId: ctx.user.id, entityType: "legal_hold", entityId: id, reason, metadata: { released: true } });
}
export async function listLegalHolds(ctx: RequestContext, tenantId?: string) {
  const scope = ctx.user.role === "SUPER_ADMIN" ? (guard(ctx), tenantId ? { tenantId } : {}) : ctx.tenant && ctx.permissions.has("privacy.manage") ? { tenantId: ctx.tenant.id } : (() => { throw new AppError("FORBIDDEN"); })();
  return db.legalHold.findMany({ where: scope, orderBy: { placedAt: "desc" }, take: 100 });
}
export async function isUnderHold(tenantId: string | null, scopeType: "TENANT" | "PATIENT" | "AUDIT", scopeId?: string) {
  return !!(await db.legalHold.findFirst({ where: { releasedAt: null, OR: [{ scopeType: "AUDIT", tenantId: null }, ...(tenantId ? [{ scopeType: "TENANT", tenantId }, { scopeType: "AUDIT", tenantId }] : []), ...(scopeType === "PATIENT" && scopeId ? [{ scopeType: "PATIENT", scopeId }] : [])] }, select: { id: true } }));
}

/* ------------------------------------------------------------ retention purge (restricted) ------------------------------------------------------------ */
/** Deletes audit rows older than the configured retention that are already sealed and not under a legal hold. Default: retention is OFF (keep forever). */
export async function purgeAudit(ctx: RequestContext, i: { password?: unknown; reason?: unknown }, now = new Date()) {
  guard(ctx); await stepUp(ctx, i.password, "audit_purge"); const reason = requireReason(i.reason, 10);
  const days = (await getSecurityPolicy()).auditRetentionDays; if (!days) throw new AppError("CONFLICT", { message: "Audit retention is not configured, so nothing may be purged." });
  const cutoff = new Date(now.getTime() - days * 86_400_000); await sealAudit(ctx, now); const seal = await lastSeal(); if (!seal) throw new AppError("CONFLICT", { message: "Nothing is sealed yet." });
  const upTo = new Date(Math.min(cutoff.getTime(), seal.toAt.getTime()));
  const held = await db.legalHold.findMany({ where: { releasedAt: null, scopeType: { in: ["AUDIT", "TENANT"] } }, select: { scopeType: true, tenantId: true } });
  if (held.some((h) => h.scopeType === "AUDIT" && h.tenantId === null)) throw new AppError("CONFLICT", { message: "A platform-wide legal hold is active; audit rows cannot be purged." });
  const heldTenants = held.map((h) => h.tenantId).filter((x): x is string => !!x);
  const first = await db.auditLog.findFirst({ where: { createdAt: { lte: upTo } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const del = await db.auditLog.deleteMany({ where: { createdAt: { lte: upTo }, hash: { not: null }, ...(heldTenants.length ? { OR: [{ tenantId: null }, { tenantId: { notIn: heldTenants } }] } : {}) } });
  if (del.count > 0) { const sig = hmacHex("audit-seal", `PURGE|${first?.createdAt.toISOString()}|${upTo.toISOString()}|${del.count}`); await db.auditSeal.create({ data: { fromAt: first?.createdAt ?? upTo, toAt: upTo, count: del.count, chainHash: `PURGE:${sig.hmac.slice(0, 16)}`, hmac: sig.hmac, keyId: sig.keyId, sealedById: ctx.user.id } }); }
  await recordAudit({ action: AUDIT_ACTIONS.SECURITY_AUDIT_PURGED, tenantId: null, actorId: ctx.user.id, reason, metadata: { purged: del.count, upTo: upTo.toISOString(), retentionDays: days, tenantsOnHold: heldTenants.length } });
  await securityEvent({ severity: "HIGH", category: "CONFIG", type: "AUDIT_PURGED", summary: `${del.count} audit row(s) purged under the retention policy`, actorId: ctx.user.id, metadata: { upTo: upTo.toISOString() } });
  return { purged: del.count, upTo };
}
