import bcrypt from "bcryptjs";
import { beforeAll, describe, expect, it } from "vitest";
import { requestStore } from "@/lib/api/request-store";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { effectivePermissions, GRANTABLE_PERMISSIONS } from "@/lib/permissions";
import { hotp, stepOf } from "@/lib/security/totp";
import { decryptString } from "@/lib/security/crypto";
import { newPatientSchema } from "@/lib/validation/scheduling";
import type { PatientContext } from "@/lib/portal/ctx";
import { ctxFor, makeUser, seedSystemData, uniq, asTenant } from "@/test/helpers";
import { createPatient } from "./patients";
import { resetStepUpFailures, stepUp } from "./platform-core";
import { changePassword, completePasswordReset, requestPasswordReset } from "./sec-account";
import { createApiKey, authenticateApiKey, listApiKeys, revokeApiKey, rotateApiKey } from "./sec-apikeys";
import { placeLegalHold, purgeAudit, releaseLegalHold, sealAudit, verifyAudit, isUnderHold } from "./sec-audit";
import { accessReview, createIncident, listSecurityEvents, securityOverview, updateIncident } from "./sec-center";
import { onAuthzDenied, onExport, onLoginFailure, onLoginSuccess } from "./sec-events";
import { beginEnrollment, confirmEnrollment, disableMfa, hasMfa, regenerateBackupCodes, verifySecondFactor, adminResetMfa } from "./sec-mfa";
import { getSecurityPolicy, mfaRequiredFor, saveSecurityPolicy, saveTenantMfaRoles } from "./sec-policy";
import { consentState, listRightsRequests, recordConsent, resolveRightsRequest, submitRightsRequest } from "./sec-privacy";
import { recordAudit, AUDIT_ACTIONS } from "@/lib/audit";

const PW = "Sa-Pass-123456!"; const DAY = 86_400_000;
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
const withCode = <T,>(c: string | undefined, f: () => Promise<T>) => requestStore.run({ mfaCode: c }, f);
let SA: ReturnType<typeof ctxFor>; let SA2: ReturnType<typeof ctxFor>;
interface Clinic { id: string; admin: ReturnType<typeof ctxFor>; staff: ReturnType<typeof ctxFor>; recep: ReturnType<typeof ctxFor> }
async function clinic(label: string): Promise<Clinic> {
  const slug = uniq(`sec-${label}`).slice(0, 30);
  const t = await db.tenant.create({ data: { name: `Sec ${label}`, slug, subdomain: slug, status: "ACTIVE", timezone: "Asia/Kolkata", branding: { create: { primaryColor: "#0B5FA5", secondaryColor: "#0F766E", accentColor: "#0E9F6E" } } } });
  const mk = async (role: "CLINIC_ADMIN" | "STAFF" | "RECEPTIONIST") => { const { user } = await makeUser(role, t.id); await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(PW, 4) } }); return ctxFor(user, role, t.id); };
  const admin = await mk("CLINIC_ADMIN");
  return { id: t.id, admin: { ...admin, tenant: { ...admin.tenant!, timezone: "Asia/Kolkata", name: "Sec" } as never }, staff: await mk("STAFF"), recep: await mk("RECEPTIONIST") };
}
const T = (c: Clinic) => asTenant(c.admin);
const secretOf = async (userId: string) => { const m = await db.userMfa.findUniqueOrThrow({ where: { userId } }); return decryptString(m.secretEnc, "mfa-secret", m.keyId); };
let A: Clinic, B: Clinic, C: Clinic;
beforeAll(async () => {
  await seedSystemData(); resetStepUpFailures();
  const mk = async () => { const { user } = await makeUser("SUPER_ADMIN", null); await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(PW, 4) } }); return ctxFor(user, "SUPER_ADMIN", null); };
  SA = await mk(); SA2 = await mk(); A = await clinic("a"); B = await clinic("b"); C = await clinic("c");
});

describe("audit integrity", () => {
  it("every record is signed; verification passes; the database refuses edits", async () => {
    await recordAudit({ action: AUDIT_ACTIONS.LOGIN_SUCCEEDED, tenantId: A.id, actorId: A.admin.user.id, metadata: { n: 1 }, ip: "1.2.3.4", userAgent: "t", reason: "because" });
    const row = await db.auditLog.findFirstOrThrow({ where: { tenantId: A.id }, orderBy: { createdAt: "desc" } }); expect(row.hash).toMatch(/^[0-9a-f]{64}$/); expect(row.reason).toBe("because");
    await expect(db.auditLog.update({ where: { id: row.id }, data: { action: "x.forged" } })).rejects.toThrow(); // refused by the database trigger
    await expect(db.auditLog.updateMany({ data: { ip: "9.9.9.9" } })).rejects.toThrow();
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe(row.action);
    const v = await verifyAudit(SA, 500); expect(v.ok).toBe(true); expect(v.tampered).toEqual([]);
    expect(await code(verifyAudit(asTenant(A.admin) as never))).toBe("FORBIDDEN");
  });
  it("detects an edited row (with the trigger bypassed) and a deleted row after sealing", async () => {
    const signed = async (ip: string, ageMin: number) => { const { auditCanonical } = await import("@/lib/audit"); const { hmacHex } = await import("@/lib/security/crypto"); const row = { id: `sig-${uniq("r")}`, action: "auth.login.succeeded", tenantId: B.id, actorId: null, entityType: null, entityId: null, metadata: null, ip, userAgent: null, createdAt: new Date(Date.now() - ageMin * 60_000), reason: null as string | null }; const g = hmacHex("audit", auditCanonical(row)); await db.auditLog.create({ data: { ...row, hash: g.hmac, hashKeyId: g.keyId } }); };
    await signed("5.5.5.5", 10); await signed("6.6.6.6", 9);
    const seal = await sealAudit(SA); expect(seal.sealed).toBe(true);
    expect((await verifyAudit(SA2, 20000)).ok).toBe(true);
    const target = await db.auditLog.findFirstOrThrow({ where: { tenantId: B.id, ip: "5.5.5.5" } });
    await db.$executeRawUnsafe('DROP TRIGGER "AuditLog_append_only"');
    try {
      await db.$executeRawUnsafe(`UPDATE "AuditLog" SET "ip" = '7.7.7.7' WHERE "id" = '${target.id}'`);
      let v = await verifyAudit(SA, 20000); expect(v.ok).toBe(false); expect(v.tampered.map((t) => t.id)).toContain(target.id);
      await db.$executeRawUnsafe(`UPDATE "AuditLog" SET "ip" = '5.5.5.5' WHERE "id" = '${target.id}'`); expect((await verifyAudit(SA, 20000)).tampered).toEqual([]);
      await db.auditLog.delete({ where: { id: target.id } }); // an attacker removes a record
      v = await verifyAudit(SA, 20000); expect(v.ok).toBe(false); expect(v.seals.some((s) => s.status === "BROKEN")).toBe(true);
      expect((await db.securityEvent.count({ where: { type: "AUDIT_INTEGRITY_FAILED" } }))).toBeGreaterThan(0);
    } finally { await db.$executeRawUnsafe('CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE ON "AuditLog" BEGIN SELECT RAISE(ABORT, \'audit log rows are append-only\'); END;'); }
  });
  it("purge needs retention set, the admin's password, honours legal holds, and leaves a signed purge record", async () => {
    // a fresh DB view: rebuild a clean sealed state by sealing everything that exists
    const c = await clinic("purge"); await saveSecurityPolicy(SA, { auditRetentionDays: null });
    expect(await code(purgeAudit(SA, { password: PW, reason: "retention clean-up run" }))).toBe("CONFLICT"); // retention not configured → nothing may be purged
    await saveSecurityPolicy(SA, { auditRetentionDays: 365 });
    const old = new Date(Date.now() - 800 * DAY); const mkOld = async (tenantId: string) => { const id = `old-${uniq("a")}`; const row = { id, action: "x.old", tenantId, actorId: null, entityType: null, entityId: null, metadata: null, ip: null, userAgent: null, createdAt: old, reason: null as string | null }; const { auditCanonical } = await import("@/lib/audit"); const { hmacHex } = await import("@/lib/security/crypto"); const s = hmacHex("audit", auditCanonical(row)); await db.auditLog.create({ data: { ...row, hash: s.hmac, hashKeyId: s.keyId } }); return id; };
    const free = await mkOld(c.id); const heldTenant = (await clinic("held")).id; const held = await mkOld(heldTenant);
    await placeLegalHold(SA, { scopeType: "TENANT", tenantId: heldTenant, reason: "litigation hold in place" });
    expect(await code(purgeAudit(SA, { password: "wrong", reason: "retention clean-up run" }))).toBe("FORBIDDEN");
    expect(await code(purgeAudit(SA, { password: PW, reason: "short" }))).toBe("VALIDATION_ERROR");
    const r = await purgeAudit(SA, { password: PW, reason: "retention clean-up run" }, new Date(Date.now() + 5 * 60_000)); expect(r.purged).toBeGreaterThanOrEqual(1);
    expect(await db.auditLog.findUnique({ where: { id: free } })).toBeNull(); expect(await db.auditLog.findUnique({ where: { id: held } })).not.toBeNull(); // the held clinic's record survives
    expect(await db.auditSeal.count({ where: { chainHash: { startsWith: "PURGE:" } } })).toBeGreaterThan(0);
    await saveSecurityPolicy(SA, { auditRetentionDays: null });
  });
});

describe("two-factor authentication", () => {
  it("enrolment needs the password, stores the secret encrypted, and shows backup codes once", async () => {
    expect(await code(beginEnrollment(A.admin, "wrong"))).toBe("FORBIDDEN");
    const { secret } = await beginEnrollment(A.admin, PW); const row = await db.userMfa.findUniqueOrThrow({ where: { userId: A.admin.user.id } }); expect(row.secretEnc).not.toContain(secret); expect(row.enabledAt).toBeNull();
    expect(await hasMfa(A.admin.user.id)).toBe(false); expect(await code(confirmEnrollment(A.admin, "000000"))).toBe("VALIDATION_ERROR");
    const { backupCodes } = await confirmEnrollment(A.admin, hotp(secret, stepOf(Date.now()))); expect(backupCodes).toHaveLength(10);
    expect(await hasMfa(A.admin.user.id)).toBe(true); expect((await db.userMfa.findUniqueOrThrow({ where: { userId: A.admin.user.id } })).backupHashes).not.toContain(backupCodes[0]);
    expect(await code(beginEnrollment(A.admin, PW))).toBe("CONFLICT");
    (A as unknown as { codes: string[] }).codes = backupCodes;
  });
  it("a TOTP code works once; a backup code works once; wrong codes are refused and rate limited", async () => {
    const uid = A.admin.user.id; const secret = await secretOf(uid); const next = hotp(secret, stepOf(Date.now()) + 1);
    expect((await verifySecondFactor(uid, next)).ok).toBe(true); expect((await verifySecondFactor(uid, next)).ok).toBe(false); // replay refused
    const codes = (A as unknown as { codes: string[] }).codes; expect((await verifySecondFactor(uid, codes[0])).used).toBe("backup"); expect((await verifySecondFactor(uid, codes[0])).ok).toBe(false);
    expect((await verifySecondFactor(uid, "111111")).ok).toBe(false); expect((await verifySecondFactor(uid, "")).reason).toBe("missing");
    const burst = await Promise.all(Array.from({ length: 10 }, () => verifySecondFactor(uid, "222222"))); expect(burst.some((r) => r.reason === "rate_limited")).toBe(true);
  });
  it("step-up for a Super Admin with two-factor needs the code too", async () => {
    const { secret } = await beginEnrollment(SA, PW); await confirmEnrollment(SA, hotp(secret, stepOf(Date.now())));
    const err = await withCode(undefined, () => stepUp(SA, PW, "t")).then(() => null, (e) => e as AppError); expect(err?.code).toBe("FORBIDDEN"); expect(err?.fieldErrors?.mfaCode).toBeTruthy();
    await withCode(hotp(secret, stepOf(Date.now()) + 1), () => stepUp(SA, PW, "t")); // a fresh step is accepted
    await expect(withCode(hotp(secret, stepOf(Date.now()) + 1), () => stepUp(SA, PW, "t"))).rejects.toThrow(); // …but never twice
    await adminResetMfa(SA2, SA.user.id, "lost device, identity verified"); expect(await hasMfa(SA.user.id)).toBe(false);
    expect(await code(adminResetMfa(A.admin, SA.user.id, "i am not allowed to do this"))).toBe("FORBIDDEN");
  });
  it("disabling needs password + a valid code, and is refused while policy requires two-factor", async () => {
    const uid = A.recep.user.id; const { secret } = await beginEnrollment(A.recep, PW); await confirmEnrollment(A.recep, hotp(secret, stepOf(Date.now())));
    await saveTenantMfaRoles(T(A), ["RECEPTIONIST"]); expect(await mfaRequiredFor("RECEPTIONIST", A.id)).toBe(true); expect(await mfaRequiredFor("RECEPTIONIST", B.id)).toBe(false);
    expect(await code(disableMfa(A.recep, PW, hotp(secret, stepOf(Date.now()) + 1)))).toBe("CONFLICT");
    await saveTenantMfaRoles(T(A), []); expect(await code(disableMfa(A.recep, PW, "000000"))).toBe("FORBIDDEN");
    const fresh = hotp(secret, stepOf(Date.now()) + 1); await disableMfa(A.recep, PW, fresh); expect(await hasMfa(uid)).toBe(false);
    expect(await code(regenerateBackupCodes(A.recep, PW, "123456"))).toBe("FORBIDDEN");
  });
  it("only a clinic admin can set the clinic's policy, and it can never loosen the platform's", async () => {
    expect(await code(saveTenantMfaRoles(asTenant(A.staff), ["STAFF"]))).toBe("FORBIDDEN");
    await saveSecurityPolicy(SA, { mfaRequiredRoles: ["ACCOUNTANT"] }); await saveTenantMfaRoles(T(A), []); expect(await mfaRequiredFor("ACCOUNTANT", A.id)).toBe(true);
    expect(await code(saveSecurityPolicy(asTenant(A.admin) as never, { mfaRequiredRoles: [] }))).toBe("FORBIDDEN"); expect(await code(saveSecurityPolicy(SA, { auditRetentionDays: 10 }))).toBe("VALIDATION_ERROR");
    await saveSecurityPolicy(SA, { mfaRequiredRoles: [] });
  });
});

describe("password change, reset and session invalidation", () => {
  it("changing the password needs the current one, a strong new one, and signs other sessions out", async () => {
    const u = A.staff; expect(await code(changePassword(u, { current: "nope", next: "Brand-new-pass-1", confirm: "Brand-new-pass-1" }))).toBe("FORBIDDEN");
    expect(await code(changePassword(u, { current: PW, next: "short", confirm: "short" }))).toBe("VALIDATION_ERROR"); expect(await code(changePassword(u, { current: PW, next: "Brand-new-pass-1", confirm: "different-1" }))).toBe("VALIDATION_ERROR");
    const before = Date.now(); await changePassword(u, { current: PW, next: "Brand-new-pass-1", confirm: "Brand-new-pass-1" });
    const row = await db.user.findUniqueOrThrow({ where: { id: u.user.id } }); expect(await bcrypt.compare("Brand-new-pass-1", row.passwordHash!)).toBe(true); expect(row.sessionsValidFrom!.getTime()).toBeGreaterThanOrEqual(before - 5);
    await db.user.update({ where: { id: u.user.id }, data: { passwordHash: await bcrypt.hash(PW, 4) } });
  });
  it("reset tokens are single-use, expire, are stored hashed, and the request never reveals whether an email exists", async () => {
    const u = B.staff; const email = (await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).email;
    expect(await requestPasswordReset("nobody@nowhere.test")).toEqual({ sent: true }); expect(await requestPasswordReset(email)).toEqual({ sent: true }); expect(await requestPasswordReset("not an email")).toEqual({ sent: true });
    const tok = await db.passwordResetToken.findFirstOrThrow({ where: { userId: u.user.id } }); expect(tok.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The raw token was only emailed; mint a known one the same way the service does to exercise completion
    const { sha256Hex, randomToken } = await import("@/lib/security/crypto"); const raw = randomToken(32);
    await db.passwordResetToken.create({ data: { userId: u.user.id, tokenHash: sha256Hex(raw), expiresAt: new Date(Date.now() + 600_000) } });
    expect(await code(completePasswordReset({ token: raw, password: "weak", confirm: "weak" }))).toBe("VALIDATION_ERROR");
    expect(await code(completePasswordReset({ token: "x".repeat(30), password: "Reset-pass-12345", confirm: "Reset-pass-12345" }))).toBe("VALIDATION_ERROR");
    const results = await Promise.all([1, 2, 3].map(() => code(completePasswordReset({ token: raw, password: "Reset-pass-12345", confirm: "Reset-pass-12345" })))); expect(results.filter((r) => r === "ok")).toHaveLength(1); // one-time even under a race
    expect(await code(completePasswordReset({ token: raw, password: "Reset-pass-67890", confirm: "Reset-pass-67890" }))).toBe("VALIDATION_ERROR");
    const exp = randomToken(32); await db.passwordResetToken.create({ data: { userId: u.user.id, tokenHash: sha256Hex(exp), expiresAt: new Date(Date.now() - 1000) } }); expect(await code(completePasswordReset({ token: exp, password: "Reset-pass-67890", confirm: "Reset-pass-67890" }))).toBe("VALIDATION_ERROR");
    expect((await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).sessionsValidFrom).toBeTruthy();
  });
});

describe("API keys", () => {
  const req = (key?: string) => new Request("http://localhost/api/v1/ping", { headers: key ? { authorization: `Bearer ${key}` } : {} });
  it("creation needs the right permission + password; the secret is shown once and only a hash is stored", async () => {
    expect(await code(createApiKey(B.recep, { name: "x", scopes: ["appointments.read"], password: PW }))).toBe("FORBIDDEN");
    expect(await code(createApiKey(B.admin, { name: "Bad", scopes: ["platform.status.read"], password: PW }))).toBe("VALIDATION_ERROR"); expect(await code(createApiKey(B.admin, { name: "Bad", scopes: ["appointments.read"], password: "wrong" }))).toBe("FORBIDDEN");
    const k = await createApiKey(B.admin, { name: "Website sync", scopes: ["appointments.read"], expiresInDays: 30, password: PW }); expect(k.key).toMatch(/^mh_[a-z0-9]+\.[A-Za-z0-9_-]{20,}$/);
    const row = await db.apiKey.findUniqueOrThrow({ where: { id: k.id } }); expect(JSON.stringify(row)).not.toContain(k.key.split(".")[1]); expect(JSON.stringify(await listApiKeys(B.admin))).not.toContain(k.key.split(".")[1]);
    (B as unknown as { key: typeof k }).key = k;
  });
  it("authenticates, enforces scope, expiry, revocation and IP allow-lists, and always answers generically", async () => {
    const k = (B as unknown as { key: { key: string; id: string } }).key; const p = await authenticateApiKey(req(k.key), "appointments.read"); expect(p.tenantId).toBe(B.id);
    expect(await code(authenticateApiKey(req(k.key), "services.read"))).toBe("FORBIDDEN"); expect(await code(authenticateApiKey(req(), "appointments.read"))).toBe("UNAUTHENTICATED");
    expect(await code(authenticateApiKey(req(k.key.slice(0, -3) + "AAA"), "appointments.read"))).toBe("UNAUTHENTICATED"); expect(await code(authenticateApiKey(req("mh_zz.short"), null))).toBe("UNAUTHENTICATED");
    const ex = await createApiKey(B.admin, { name: "Expired soon", scopes: ["services.read"], expiresInDays: 1, password: PW }); await db.apiKey.update({ where: { id: ex.id }, data: { expiresAt: new Date(Date.now() - 1000) } }); expect(await code(authenticateApiKey(req(ex.key), "services.read"))).toBe("UNAUTHENTICATED");
    const ipk = await createApiKey(B.admin, { name: "Pinned", scopes: ["services.read"], expiresInDays: 5, allowedIps: ["203.0.113.9"], password: PW }); expect(await code(authenticateApiKey(req(ipk.key), "services.read"))).toBe("UNAUTHENTICATED"); // test requests have no matching address
    expect(await db.securityEvent.count({ where: { category: "API_KEY", type: { in: ["API_KEY_BAD", "API_KEY_EXPIRED_USED", "API_KEY_IP_DENIED"] } } })).toBeGreaterThanOrEqual(3);
    expect(await code(revokeApiKey(B.admin, k.id, "wrong"))).toBe("FORBIDDEN"); await revokeApiKey(B.admin, k.id, PW); expect(await code(authenticateApiKey(req(k.key), "appointments.read"))).toBe("UNAUTHENTICATED");
    expect((await db.securityEvent.findFirst({ where: { type: "API_KEY_REVOKED_USED" } }))).toBeTruthy();
  });
  it("rotation issues a new key and kills the old; another clinic's keys are invisible and untouchable", async () => {
    const k = await createApiKey(B.admin, { name: "Rotating", scopes: ["services.read"], expiresInDays: 10, password: PW }); const n = await rotateApiKey(B.admin, k.id, PW); expect(n.key).not.toBe(k.key);
    expect(await code(authenticateApiKey(req(k.key), "services.read"))).toBe("UNAUTHENTICATED"); expect((await authenticateApiKey(req(n.key), "services.read")).tenantId).toBe(B.id);
    expect((await listApiKeys(C.admin)).map((x) => x.id)).not.toContain(n.id); expect(await code(revokeApiKey(C.admin, n.id, PW))).toBe("NOT_FOUND"); expect(await code(rotateApiKey(C.admin, n.id, PW))).toBe("NOT_FOUND");
    const plat = await createApiKey(SA, { name: "Status", scopes: ["platform.status.read"], expiresInDays: 10, password: PW }); expect((await authenticateApiKey(req(plat.key), "platform.status.read")).tenantId).toBeNull();
    expect(await code(createApiKey(SA, { name: "Bad", scopes: ["appointments.read"], password: PW }))).toBe("VALIDATION_ERROR"); expect((await listApiKeys(SA)).every((x) => x.id !== n.id)).toBe(true);
  });
});

describe("security events, detection and incidents", () => {
  it("flags brute force and success-after-failures, throttles authz noise, and flags unusual export volume", async () => {
    for (let i = 0; i < 10; i++) await onLoginFailure({ identifierKnown: false, reason: "bad_password", ip: "198.51.100.7" });
    expect(await db.securityEvent.count({ where: { type: "BRUTE_FORCE_SUSPECTED", ip: "198.51.100.7" } })).toBe(1); // deduplicated
    const victim = A.staff.user.id; for (let i = 0; i < 5; i++) await onLoginFailure({ identifierKnown: true, userId: victim, reason: "bad_password", ip: "198.51.100.8" });
    await onLoginSuccess({ userId: victim, tenantId: A.id }); expect(await db.securityEvent.count({ where: { type: "LOGIN_AFTER_FAILURES", actorId: victim } })).toBe(1);
    for (let i = 0; i < 5; i++) await onAuthzDenied({ actorId: victim, tenantId: A.id, path: "/api/x", code: "FORBIDDEN" }); expect(await db.securityEvent.count({ where: { type: "AUTHZ_DENIED", actorId: victim } })).toBe(1);
    for (let i = 0; i < 8; i++) await onExport({ actorId: victim, tenantId: A.id, kind: "test" }); expect(await db.securityEvent.count({ where: { type: "UNUSUAL_EXPORT_VOLUME", actorId: victim } })).toBe(1);
    expect(await db.notification.count({ where: { type: "SECURITY_ALERT" } })).toBeGreaterThan(0); // HIGH events alert Super Admins in-app
  });
  it("metadata is redacted and nothing secret reaches the event store", async () => {
    const { securityEvent } = await import("./sec-events"); await securityEvent({ severity: "LOW", category: "CONFIG", type: "T", summary: "s", metadata: { password: "hunter2", token: "abc", ok: 1 } });
    const e = await db.securityEvent.findFirstOrThrow({ where: { type: "T" } }); expect(e.metadata).not.toContain("hunter2"); expect(e.metadata).not.toContain("abc");
  });
  it("the Security Center is Super-Admin only and reports real numbers", async () => {
    const o = await securityOverview(SA); expect(o.last24h.LOW).toBeGreaterThan(0); expect(o.failedLogins24h).toBeGreaterThanOrEqual(15); expect(o.topFailingIps[0].failures).toBeGreaterThanOrEqual(5);
    for (const f of [() => securityOverview(A.admin), () => listSecurityEvents(A.admin, {}), () => accessReview(A.admin), () => createIncident(A.admin, { title: "hello there", description: "long enough description" })]) expect(await code(f())).toBe("FORBIDDEN");
    expect((await listSecurityEvents(SA, { severity: "HIGH" })).rows.every((r) => r.severity === "HIGH")).toBe(true);
    const ar = await accessReview(SA); expect(ar.privileged.some((p) => p.role === "CLINIC_ADMIN")).toBe(true);
  });
  it("incidents follow a valid lifecycle with a timeline", async () => {
    expect(await code(createIncident(SA, { title: "x", description: "y" }))).toBe("VALIDATION_ERROR");
    const i = await createIncident(SA, { title: "Suspicious exports", description: "Unusual export volume from one account", severity: "HIGH", category: "EXPORT", tenantId: A.id }); expect(i.incidentNumber).toMatch(/^SEC-\d{4}-\d{4}$/);
    expect(await code(updateIncident(SA, i.id, { status: "CLOSED" }))).toBe("CONFLICT"); expect(await code(updateIncident(SA, i.id, { status: "RESOLVED" }))).toBe("VALIDATION_ERROR"); // needs a resolution
    await updateIncident(SA, i.id, { status: "INVESTIGATING", note: "pulling export logs", assignedToId: SA.user.id }); await updateIncident(SA, i.id, { status: "RESOLVED", resolution: "Account password reset and sessions revoked." }); await updateIncident(SA2, i.id, { status: "CLOSED" });
    const full = await db.securityIncident.findUniqueOrThrow({ where: { id: i.id }, include: { events: true } }); expect(full.status).toBe("CLOSED"); expect(full.resolvedAt).toBeTruthy(); expect(full.events.length).toBeGreaterThanOrEqual(5);
    expect(await code(updateIncident(SA, i.id, { status: "OPEN" }))).toBe("CONFLICT");
  });
});

describe("privacy: consent, data-rights requests, legal holds", () => {
  let patA: string; let patB: string; let pctx: PatientContext;
  beforeAll(async () => {
    patA = (await createPatient(T(A), newPatientSchema.parse({ name: "Privacy Patient", phone: "9811122233" }), { allowDuplicate: true })).id;
    patB = (await createPatient(T(B), newPatientSchema.parse({ name: "Other Clinic Patient", phone: "9811122244" }), { allowDuplicate: true })).id;
    pctx = { ...asTenant(A.admin), patientId: patA, accountId: "acc", patient: { id: patA, code: "P", name: "Privacy Patient", preferredName: null } } as unknown as PatientContext;
  });
  it("consents are independent, versioned and never edited; transactional consent does not grant marketing", async () => {
    await recordConsent(T(A), patA, { type: "COMMUNICATION", status: "GRANTED", version: "v2", purpose: "TRANSACTIONAL", source: "STAFF" });
    let s = await consentState(T(A), patA); expect(s.current.find((c) => c.type === "COMMUNICATION")?.status).toBe("GRANTED"); expect(s.current.find((c) => c.type === "MARKETING")).toBeUndefined();
    await recordConsent(T(A), patA, { type: "COMMUNICATION", status: "WITHDRAWN", version: "v2", purpose: "TRANSACTIONAL" }); s = await consentState(T(A), patA); expect(s.current.filter((c) => c.type === "COMMUNICATION")).toHaveLength(1); expect(s.current.find((c) => c.type === "COMMUNICATION")?.status).toBe("WITHDRAWN"); expect(s.history.length).toBeGreaterThanOrEqual(2);
    expect(await code(recordConsent(T(A), patA, { type: "NOPE", status: "GRANTED", version: "v1" }))).toBe("VALIDATION_ERROR"); expect(await code(recordConsent(T(A), patA, { type: "PRIVACY", status: "GRANTED", version: "" }))).toBe("VALIDATION_ERROR");
    expect(await code(recordConsent(T(A), patB, { type: "PRIVACY", status: "GRANTED", version: "v1" }))).toBe("NOT_FOUND"); // another clinic's patient
    expect(await code(consentState(T(B), patA))).toBe("ok"); expect((await consentState(T(B), patA)).current).toEqual([]); // sees nothing of A's patient
  });
  it("a patient can raise a data-rights request; duplicates and abuse are limited", async () => {
    expect(await code(submitRightsRequest(pctx, { kind: "HACK", reason: "something" }))).toBe("VALIDATION_ERROR"); expect(await code(submitRightsRequest(pctx, { kind: "DATA_EXPORT", reason: "x" }))).toBe("VALIDATION_ERROR");
    const r = await submitRightsRequest(pctx, { kind: "DATA_EXPORT", reason: "I want a copy of my records" }); expect(r.requestNumber).toMatch(/^PRQ-\d{4}-\d{6}$/); expect(r.dueAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(await code(submitRightsRequest(pctx, { kind: "DATA_EXPORT", reason: "again please" }))).toBe("CONFLICT");
    await submitRightsRequest(pctx, { kind: "ERASURE", reason: "Delete everything about me" }); await submitRightsRequest(pctx, { kind: "CONSENT_WITHDRAWAL", reason: "Stop messaging me" });
  });
  it("clinic staff with the privacy permission handle requests; erasure can never silently delete records", async () => {
    expect(await code(listRightsRequests(asTenant(A.recep)))).toBe("FORBIDDEN"); const list = await listRightsRequests(T(A)); expect(list.rows.length).toBe(3); expect((await listRightsRequests(T(B))).rows).toHaveLength(0);
    const by = (k: string) => list.rows.find((r) => r.kind === k)!;
    expect(await code(resolveRightsRequest(T(A), by("ERASURE").id, { outcome: "FULFILLED", note: "deleting all of it now" }))).toBe("CONFLICT");
    expect(await code(resolveRightsRequest(T(A), by("ERASURE").id, { outcome: "RETENTION_EXCEPTION", note: "short" }))).toBe("VALIDATION_ERROR");
    await resolveRightsRequest(T(A), by("ERASURE").id, { outcome: "RETENTION_EXCEPTION", note: "Clinical records must be retained under medical record rules." }); expect(await db.patient.findUnique({ where: { id: patA } })).toBeTruthy();
    const exp = await resolveRightsRequest(T(A), by("DATA_EXPORT").id, { outcome: "FULFILLED", note: "Copy prepared and handed over securely." }); expect((exp.export as { patient: { id: string } }).patient.id).toBe(patA);
    expect(await code(resolveRightsRequest(T(B), by("CONSENT_WITHDRAWAL").id, { outcome: "FULFILLED", note: "attempt from another clinic" }))).toBe("NOT_FOUND");
    await placeLegalHold(T(A), { scopeType: "PATIENT", scopeId: patA, reason: "Open medico-legal case" }); expect(await isUnderHold(A.id, "PATIENT", patA)).toBe(true);
    expect(await code(resolveRightsRequest(T(A), by("CONSENT_WITHDRAWAL").id, { outcome: "FULFILLED", note: "withdraw all communication consent" }))).toBe("CONFLICT"); // held
    const hold = (await db.legalHold.findFirstOrThrow({ where: { tenantId: A.id, scopeId: patA } })); await releaseLegalHold(T(A), hold.id, "Case closed, hold lifted"); expect(await isUnderHold(A.id, "PATIENT", patA)).toBe(false);
    await resolveRightsRequest(T(A), by("CONSENT_WITHDRAWAL").id, { outcome: "FULFILLED", note: "All messaging consents withdrawn." }); expect((await consentState(T(A), patA)).current.filter((c) => ["COMMUNICATION", "SMS", "WHATSAPP", "EMAIL", "MARKETING"].includes(c.type)).every((c) => c.status === "WITHDRAWN")).toBe(true);
    expect(await code(resolveRightsRequest(T(A), by("ERASURE").id, { outcome: "NOT_APPLICABLE", note: "closed twice should fail" }))).toBe("CONFLICT");
  });
  it("legal holds: clinics can only hold their own patients; releasing someone else's hold is invisible", async () => {
    expect(await code(placeLegalHold(T(A), { scopeType: "PATIENT", scopeId: patB, reason: "not my patient at all" }))).toBe("NOT_FOUND"); expect(await code(placeLegalHold(T(A), { scopeType: "TENANT", reason: "clinic admins cannot freeze the clinic" }))).toBe("FORBIDDEN");
    const h = await placeLegalHold(SA, { scopeType: "TENANT", tenantId: B.id, reason: "platform legal hold for clinic B" }); expect(await code(releaseLegalHold(T(A), h.id, "trying to lift B's hold"))).toBe("NOT_FOUND"); await releaseLegalHold(SA, h.id, "hold lifted by legal team");
  });
});

describe("permissions", () => {
  it("security/privacy/API-key powers belong to clinic admins only and cannot be granted", () => {
    for (const p of ["security.manage", "privacy.manage", "apikeys.manage"] as const) { expect(effectivePermissions("CLINIC_ADMIN").has(p), p).toBe(true); expect((GRANTABLE_PERMISSIONS as readonly string[]).includes(p), p).toBe(false); for (const r of ["DOCTOR", "RECEPTIONIST", "ACCOUNTANT", "STAFF", "PHARMACY_MANAGER", "NURSE", "LAB_STAFF"] as const) expect(effectivePermissions(r, [p]).has(p), `${r}/${p}`).toBe(false); }
    expect(effectivePermissions("PATIENT").has("security.manage")).toBe(false);
  });
  it("defaults are safe: nothing is forced on, nothing is purged", async () => { const p = await getSecurityPolicy(); expect(p.mfaRequiredRoles).toEqual([]); expect(p.auditRetentionDays).toBeNull(); });
});
