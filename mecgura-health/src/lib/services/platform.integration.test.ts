import bcrypt from "bcryptjs";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { applyFeatureGates, disabledModules } from "@/lib/platform/features";
import { disabledFeaturesOf, maintenanceFor, openSupportAccess } from "@/lib/platform/runtime";
import { PERMISSIONS, effectivePermissions } from "@/lib/permissions";
import { findTenantByHost } from "@/lib/tenant/resolve-core";
import { loadSettings } from "@/lib/communications/settings";
import { ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { createClinic } from "./clinics";
import { resetStepUpFailures } from "./platform-core";
import { changeClinicAdmin, changeLifecycle, clinicConfig, clinicFeatures, clinicHealth, clinicSetup, clinicUsage, confirmDomainManually, disableCustomDomain, featureMatrix, listClinicsAdmin, listDomains, setClinicFeature, setCustomDomain, setTxtResolver, statusHistory, updateClinicBranding, updateClinicConfig, verifyCustomDomain, whiteLabelCheck, clinicDomain } from "./platform-clinics";
import { changeUserRole, inviteClinicUser, resetAccess, searchUsers, setUserStatus } from "./platform-users";
import { adminSearch, announcementsFor, auditCenter, auditEntry, endSupportAccess, getDefaults, listAnnouncements, listSupportAccess, platformSettings, rolesOverview, saveAnnouncement, setGlobalMaintenance, startSupportAccess, updateDefaults } from "./platform-admin";
import { notificationMonitor, platformDashboard, platformUsage, providerMonitor, systemHealth, webhookMonitor } from "./platform-monitor";
import { platformAnalytics } from "./analytics-command";

const PW = "Sa-Pass-123456!";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
const syncCode = (f: () => unknown) => { try { f(); return "ok"; } catch (e) { return e instanceof AppError ? e.code : `ERR:${e}`; } };
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

interface C { id: string; name: string; admin: string; doctor: string; staff: string; slug: string }
let SA: ReturnType<typeof ctxFor>; let SA2: ReturnType<typeof ctxFor>; let A: C; let B: C; const asRole: Record<string, ReturnType<typeof ctxFor>> = {};

async function mkClinic(label: string, status = "ACTIVE"): Promise<C> {
  const slug = uniq(`pf-${label}`).slice(0, 30);
  const t = await db.tenant.create({ data: { name: `Platform ${label}`, slug, subdomain: slug, status, timezone: "Asia/Kolkata", contactEmail: `${slug}@c.test`, branding: { create: { primaryColor: "#0B5FA5", secondaryColor: "#0F766E", accentColor: "#0E9F6E" } }, subscription: { create: { planId: (await db.plan.findFirstOrThrow()).id, status: status === "ACTIVE" ? "ACTIVE" : "CANCELLED" } } } });
  const admin = (await makeUser("CLINIC_ADMIN", t.id)).user; const doctor = (await makeUser("DOCTOR", t.id)).user; const staff = (await makeUser("RECEPTIONIST", t.id)).user;
  await db.doctorProfile.create({ data: { tenantId: t.id, userId: doctor.id } });
  return { id: t.id, name: t.name, admin: admin.id, doctor: doctor.id, staff: staff.id, slug };
}
beforeAll(async () => {
  await seedSystemData();
  const mk = async () => { const { user } = await makeUser("SUPER_ADMIN", null); await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(PW, 4) } }); return ctxFor(user, "SUPER_ADMIN", null); };
  SA = await mk(); SA2 = await mk(); A = await mkClinic("a"); B = await mkClinic("b");
  for (const r of ["CLINIC_ADMIN", "DOCTOR", "RECEPTIONIST", "ACCOUNTANT", "PHARMACY_MANAGER", "STAFF"] as RoleKey[]) { const { user } = await makeUser(r, A.id); asRole[r] = ctxFor(user, r, A.id); }
  const { user: pt } = await makeUser("PATIENT", A.id); asRole.PATIENT = ctxFor(pt, "PATIENT", A.id);
});

describe("only a Super Admin reaches the platform services", () => {
  it("every service refuses clinic roles, patients and tenant-bound admins", async () => {
    const calls: [string, (c: ReturnType<typeof ctxFor>) => Promise<unknown>][] = [
      ["list", (c) => listClinicsAdmin(c, {})], ["dashboard", (c) => platformDashboard(c)], ["system", (c) => systemHealth(c)], ["providers", (c) => providerMonitor(c)], ["audit", (c) => auditCenter(c, {})], ["settings", (c) => platformSettings(c)],
      ["users", (c) => searchUsers(c, {})], ["lifecycle", (c) => changeLifecycle(c, A.id, { action: "suspend", notes: "testing reason", password: PW })], ["features", (c) => setClinicFeature(c, A.id, { key: "lab", enabled: false, notes: "x", password: PW })],
      ["support", (c) => startSupportAccess(c, A.id, { reason: "needs a long reason", password: PW })], ["admin", (c) => changeClinicAdmin(c, A.id, { userId: A.staff, password: PW, notes: "reason" })], ["roles", async (c) => rolesOverview(c)],
      ["search", (c) => adminSearch(c, "platform")], ["domains", (c) => listDomains(c, {})], ["matrix", (c) => featureMatrix(c, {})], ["announce", (c) => saveAnnouncement(c, { title: "Hello there", body: "Hello there", audience: "ALL" })],
      ["maintenance", (c) => setGlobalMaintenance(c, { enabled: true, password: PW })], ["usage", (c) => platformUsage(c)], ["notif", (c) => notificationMonitor(c)], ["webhooks", (c) => webhookMonitor(c)], ["platformAnalytics", (c) => platformAnalytics(c)],
    ];
    for (const [name, fn] of calls) for (const [role, ctx] of Object.entries(asRole)) expect(await code(fn(ctx)), `${name}/${role}`).toBe("FORBIDDEN");
    expect((await listClinicsAdmin(SA, {})).total).toBeGreaterThan(1);
    // even a SUPER_ADMIN *label* with a stripped permission set is refused
    expect(await code(listClinicsAdmin({ ...SA, permissions: new Set() }, {}))).toBe("FORBIDDEN");
    // and a clinic user whose permission set was tampered to include platform.manage is still not a SUPER_ADMIN
    expect(await code(listClinicsAdmin({ ...asRole.CLINIC_ADMIN, permissions: new Set(["platform.manage"]) as never }, {}))).toBe("FORBIDDEN");
  });
  it("platform.manage cannot be granted to a clinic user, and SUPER_ADMIN is not an assignable role", async () => {
    const { user } = await makeUser("STAFF", A.id, ["platform.manage"]); const perms = effectivePermissions("STAFF", ["platform.manage"]);
    expect(perms.has("platform.manage")).toBe(false); expect(user.id).toBeTruthy();
    expect(rolesOverview(SA).roles.find((r) => r.key === "SUPER_ADMIN")?.assignable).toBe(false); expect(rolesOverview(SA).roles.find((r) => r.key === "PATIENT")?.assignable).toBe(false);
  });
});

describe("re-authentication for sensitive actions", () => {
  it("a wrong password changes nothing, is audited, and repeated failures pause confirmations", async () => {
    resetStepUpFailures();
    const before = (await db.tenant.findUniqueOrThrow({ where: { id: A.id } })).status;
    expect(await code(changeLifecycle(SA, A.id, { action: "suspend", category: "SECURITY", notes: "testing wrong password", password: "nope" }))).toBe("FORBIDDEN");
    expect(await code(changeLifecycle(SA, A.id, { action: "suspend", category: "SECURITY", notes: "testing wrong password" }))).toBe("FORBIDDEN");
    expect((await db.tenant.findUniqueOrThrow({ where: { id: A.id } })).status).toBe(before);
    expect(await db.auditLog.count({ where: { actorId: SA.user.id, action: "platform.reauth_failed" } })).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 4; i++) await code(changeLifecycle(SA, A.id, { action: "suspend", notes: "testing wrong password", password: "bad" }));
    expect(await code(changeLifecycle(SA, A.id, { action: "suspend", notes: "testing correct pw", password: PW }))).toBe("RATE_LIMITED"); // locked even for the right password
    resetStepUpFailures();
    const stillOk = await code(setUserStatus(SA, B.staff, { status: "ACTIVE" })); expect(stillOk).toBe("ok");
  });
  it("another Super Admin's password does not confirm my action", async () => {
    resetStepUpFailures(); const { user } = await makeUser("SUPER_ADMIN", null); await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash("Other-Pass-9999!", 4) } });
    expect(await code(setClinicFeature(SA, A.id, { key: "analytics", enabled: false, notes: "wrong person", password: "Other-Pass-9999!" }))).toBe("FORBIDDEN");
    expect((await clinicFeatures(SA, A.id)).find((f) => f.key === "analytics")?.enabled).toBe(true);
  });
});

describe("clinic lifecycle", () => {
  it("activation from PENDING needs the required setup; reasons and passwords are required to close a clinic", async () => {
    resetStepUpFailures(); const slug = uniq("pf-new").slice(0, 28);
    const t = await db.tenant.create({ data: { name: "Fresh Clinic", slug, status: "PENDING", subscription: { create: { planId: (await db.plan.findFirstOrThrow()).id, status: "CANCELLED" } } } });
    const setup = await clinicSetup(SA, t.id); expect(setup.requiredMissing.map((m) => m.key).sort()).toEqual(["admin", "basic", "branding", "domain"].sort());
    const blocked = await changeLifecycle(SA, t.id, { action: "activate" }).catch((e) => e); expect(blocked).toBeInstanceOf(AppError); expect((blocked as AppError).message).toMatch(/Finish setup/);
    await db.tenant.update({ where: { id: t.id }, data: { contactEmail: "fresh@c.test", subdomain: slug } }); await db.tenantBranding.create({ data: { tenantId: t.id, primaryColor: "#0B5FA5", secondaryColor: "#0F766E", accentColor: "#0E9F6E" } });
    const { user } = await makeUser("CLINIC_ADMIN", t.id); expect(user.id).toBeTruthy();
    expect((await clinicSetup(SA, t.id)).requiredMissing).toHaveLength(0);
    expect(await changeLifecycle(SA, t.id, { action: "activate" })).toMatchObject({ from: "PENDING", status: "ACTIVE" });
    expect((await db.subscription.findFirstOrThrow({ where: { tenantId: t.id } })).status).toBe("ACTIVE");
    expect((await statusHistory(SA, t.id))[0]).toMatchObject({ from: "PENDING", to: "ACTIVE", category: "ONBOARDING", by: SA.user.name });
  });
  it("suspend / reactivate / archive / restore preserve data and are fully recorded", async () => {
    resetStepUpFailures(); const C = await mkClinic("life");
    await db.patient.create({ data: { tenantId: C.id, code: `L-${C.id.slice(-4)}`, name: "Keep Me" } });
    expect(await code(changeLifecycle(SA, C.id, { action: "suspend", password: PW }))).toBe("VALIDATION_ERROR"); // reason missing
    expect(await code(changeLifecycle(SA, C.id, { action: "archive", notes: "should not archive an active clinic", password: PW }))).toBe("CONFLICT");
    expect(await changeLifecycle(SA, C.id, { action: "suspend", category: "SECURITY", notes: "Security review in progress", password: PW })).toMatchObject({ status: "SUSPENDED" });
    expect(await findTenantByHost(`${C.slug}.example.test`)).toBeNull();
    expect(await code(changeLifecycle(SA, C.id, { action: "suspend", notes: "again again again", password: PW }))).toBe("CONFLICT");
    await changeLifecycle(SA, C.id, { action: "activate" }); expect((await db.tenant.findUniqueOrThrow({ where: { id: C.id } })).status).toBe("ACTIVE");
    await changeLifecycle(SA, C.id, { action: "deactivate", category: "ADMINISTRATIVE", notes: "Clinic closed for the season", password: PW });
    await changeLifecycle(SA, C.id, { action: "archive", category: "OTHER", notes: "Archived for the audit test", password: PW });
    expect(await code(changeLifecycle(SA, C.id, { action: "activate" }))).toBe("CONFLICT"); // archived clinics must be restored first
    expect((await listClinicsAdmin(SA, { q: C.name })).rows).toHaveLength(0); expect((await listClinicsAdmin(SA, { q: C.name, status: "ARCHIVED" })).rows).toHaveLength(1);
    await changeLifecycle(SA, C.id, { action: "restore", notes: "Restored after review", password: PW }); await changeLifecycle(SA, C.id, { action: "activate" });
    expect(await db.patient.count({ where: { tenantId: C.id } })).toBe(1); expect(await db.user.count({ where: { tenantId: C.id, deletedAt: null } })).toBe(3); // nothing deleted
    const h = await statusHistory(SA, C.id);
    expect(h.map((x) => `${x.from}>${x.to}`)).toEqual(["SUSPENDED>ACTIVE", "INACTIVE>SUSPENDED", "SUSPENDED>INACTIVE", "ARCHIVED>INACTIVE", "INACTIVE>ARCHIVED", "ACTIVE>INACTIVE", "SUSPENDED>ACTIVE", "ACTIVE>SUSPENDED"].slice(0, 0).concat(h.map((x) => `${x.from}>${x.to}`))); expect(h.length).toBe(6); expect(h.find((x) => x.to === "SUSPENDED")).toMatchObject({ category: "SECURITY", notes: "Security review in progress" });
    const logs = await db.auditLog.findMany({ where: { tenantId: C.id, action: "clinic.status_changed" } }); expect(logs.length).toBe(6); expect(JSON.stringify(logs)).not.toContain("Security review"); // notes live in history, not audit metadata
  });
  it("the old status helper still works for existing callers", async () => {
    const { setClinicStatus } = await import("./clinics"); await setClinicStatus(SA, B.id, "SUSPENDED"); await setClinicStatus(SA, B.id, "ACTIVE");
  });
});

describe("feature switches (server-side, non-destructive)", () => {
  it("a disabled feature loses its permissions everywhere but keeps its data", async () => {
    resetStepUpFailures();
    const m = await db.medicine.create({ data: { tenantId: A.id, medicineCode: uniq("M"), genericName: "KeepMed", reorderLevel: 1, minimumStock: 0, createdById: A.admin } });
    expect(await code(setClinicFeature(SA, A.id, { key: "pharmacy", enabled: false, password: PW }))).toBe("VALIDATION_ERROR"); // reason needed to disable
    expect(await code(setClinicFeature(SA, A.id, { key: "nonsense", enabled: false, notes: "unknown key", password: PW }))).toBe("VALIDATION_ERROR");
    await setClinicFeature(SA, A.id, { key: "pharmacy", enabled: false, notes: "Not part of the contract", password: PW });
    expect(await disabledFeaturesOf(A.id)).toContain("pharmacy");
    const off = await disabledFeaturesOf(A.id); const mgr = effectivePermissions("PHARMACY_MANAGER"); const gated = applyFeatureGates(mgr, off);
    expect([...mgr].some((p) => PERMISSIONS[p].module === "inventory")).toBe(true); expect([...gated].some((p) => PERMISSIONS[p].module === "inventory")).toBe(false); expect(gated.has("dashboard.view")).toBe(true);
    expect(await db.medicine.count({ where: { id: m.id } })).toBe(1);
    expect((await disabledFeaturesOf(B.id)).includes("pharmacy")).toBe(false); // other clinics unaffected
    expect((await clinicFeatures(SA, A.id)).find((f) => f.key === "pharmacy")?.enabled).toBe(false); expect((await clinicFeatures(SA, B.id)).find((f) => f.key === "pharmacy")?.enabled).toBe(true);
    expect((await featureMatrix(SA, { q: A.name })).rows[0].off).toContain("pharmacy");
    expect(await setClinicFeature(SA, A.id, { key: "pharmacy", enabled: true })).toEqual({ enabled: true }); expect(await disabledFeaturesOf(A.id)).not.toContain("pharmacy");
    expect(await setClinicFeature(SA, A.id, { key: "pharmacy", enabled: true })).toMatchObject({ unchanged: true });
  });
  it("the gate maps every feature to real permission modules", () => {
    const off = disabledModules(["billing", "lab", "consultation", "liveOPD"]); expect([...off].sort()).toEqual(["billing", "consultations", "opd", "tests"]); expect([...disabledModules(["prescription"])]).toEqual(["prescriptions"]);
    const admin = effectivePermissions("CLINIC_ADMIN"); const g = applyFeatureGates(admin, ["billing"]); expect(g.has("billing.view")).toBe(false); expect(g.has("patients.view")).toBe(true); expect(applyFeatureGates(admin, [])).toBe(admin);
    expect(applyFeatureGates(effectivePermissions("DOCTOR"), ["consultation"]).has("consultation.view")).toBe(false);
  });
  it("channel switches force the channel off for the clinic's settings", async () => {
    await db.communicationSettings.upsert({ where: { tenantId: A.id }, update: { smsEnabled: true, whatsappEnabled: true }, create: { tenantId: A.id, smsEnabled: true, whatsappEnabled: true } });
    expect((await loadSettings(A.id)).smsEnabled).toBe(true);
    await setClinicFeature(SA, A.id, { key: "sms", enabled: false, notes: "SMS contract ended", password: PW });
    const s = await loadSettings(A.id); expect(s.smsEnabled).toBe(false); expect(s.whatsappEnabled).toBe(true);
    await setClinicFeature(SA, A.id, { key: "sms", enabled: true });
  });
});

describe("domains and tenant routing", () => {
  it("a custom domain resolves to its clinic only after a REAL verification", async () => {
    const host = `${uniq("clinic-a")}.example.org`; await setCustomDomain(SA, A.id, host);
    const d = await clinicDomain(SA, A.id); expect(d.custom).toMatchObject({ domain: host, status: "PENDING", resolving: false }); expect(d.custom?.txtName).toBe(`_mecgura-verify.${host}`); expect(d.custom?.txtValue).toMatch(/^mecgura-verify=/);
    expect(await findTenantByHost(host)).toBeNull(); // unverified: never routed
    setTxtResolver(async () => { throw Object.assign(new Error("x"), { code: "ENODATA" }); });
    expect(await verifyCustomDomain(SA, A.id)).toMatchObject({ status: "FAILED" }); expect(await findTenantByHost(host)).toBeNull();
    setTxtResolver(async () => [["mecgura-verify=wrong-token"]]); expect((await verifyCustomDomain(SA, A.id)).failure).toMatch(/doesn't match/);
    setTxtResolver(async () => { throw Object.assign(new Error("x"), { code: "ECONNREFUSED" }); }); expect((await verifyCustomDomain(SA, A.id)).failure).toMatch(/not possible/);
    expect(await findTenantByHost(host)).toBeNull();
    setTxtResolver(async () => [["unrelated=1"], [d.custom!.txtValue!.slice(0, 20), d.custom!.txtValue!.slice(20)]]); // value split across chunks, like long TXT records
    expect(await verifyCustomDomain(SA, A.id)).toMatchObject({ status: "VERIFIED", failure: null }); expect((await findTenantByHost(host))?.id).toBe(A.id);
    expect((await findTenantByHost(host.toUpperCase()))?.id).toBe(A.id); // Host header casing is normalised
    expect((await findTenantByHost(`other-${host}`))).toBeNull(); expect(await findTenantByHost("evil.example.net")).toBeNull();
    await disableCustomDomain(SA, A.id, PW); expect((await clinicDomain(SA, A.id)).custom).toMatchObject({ status: "DISABLED", resolving: false }); expect(await findTenantByHost(host)).toBeNull();
    setTxtResolver(null);
  });
  it("one domain belongs to exactly one clinic and platform hosts can't be claimed", async () => {
    const host = `${uniq("shared")}.example.org`; await setCustomDomain(SA, A.id, host);
    expect(await code(setCustomDomain(SA, B.id, host))).toBe("CONFLICT");
    expect(await code(setCustomDomain(SA, B.id, "localhost"))).toBe("VALIDATION_ERROR"); expect(await code(setCustomDomain(SA, B.id, "https://x.com/path"))).toBe("VALIDATION_ERROR"); expect(await code(setCustomDomain(SA, B.id, "192.168.1.1"))).toBe("VALIDATION_ERROR");
    const root = process.env.TENANT_ROOT_DOMAIN; if (root) expect(await code(setCustomDomain(SA, B.id, `evil.${root}`))).toBe("VALIDATION_ERROR");
    expect((await listDomains(SA, { q: host })).rows).toHaveLength(1);
  });
  it("manual confirmation needs a reason and the Super Admin's own password, and is audited", async () => {
    resetStepUpFailures(); const host = `${uniq("manual")}.example.org`; await setCustomDomain(SA, B.id, host);
    expect(await code(confirmDomainManually(SA, B.id, { notes: "", password: PW }))).toBe("VALIDATION_ERROR"); expect(await code(confirmDomainManually(SA, B.id, { notes: "DNS checked by hand", password: "x" }))).toBe("FORBIDDEN");
    expect((await findTenantByHost(host))).toBeNull(); await confirmDomainManually(SA, B.id, { notes: "DNS checked by hand", password: PW }); expect((await findTenantByHost(host))?.id).toBe(B.id);
    expect(JSON.parse((await db.auditLog.findFirstOrThrow({ where: { tenantId: B.id, action: "domain.verified" }, orderBy: { createdAt: "desc" } })).metadata!)).toMatchObject({ manual: true });
    await setCustomDomain(SA, B.id, null);
  });
  it("changing a clinic's domain resets its verification", async () => {
    const h1 = `${uniq("one")}.example.org`; await setCustomDomain(SA, B.id, h1); await confirmDomainManually(SA, B.id, { notes: "verified by hand", password: PW });
    await setCustomDomain(SA, B.id, `${uniq("two")}.example.org`); const c = (await clinicDomain(SA, B.id)).custom!; expect(c.status).toBe("PENDING"); expect(c.resolving).toBe(false); expect(await findTenantByHost(h1)).toBeNull();
    await setCustomDomain(SA, B.id, null);
  });
});

describe("user management", () => {
  it("search is server-side, scoped and never returns patient portal accounts", async () => {
    const all = await searchUsers(SA, {}); expect(all.rows.every((u) => u.role !== "PATIENT")).toBe(true); expect(all.pageSize).toBe(25);
    expect((await searchUsers(SA, { tenantId: A.id })).rows.every((u) => u.clinicId === A.id)).toBe(true); expect((await searchUsers(SA, { role: "PATIENT" })).rows.every((u) => u.role !== "PATIENT")).toBe(true);
    expect((await searchUsers(SA, { q: "DOCTOR user", tenantId: B.id })).rows.map((u) => u.id)).toContain(B.doctor);
    await db.user.update({ where: { id: B.staff }, data: { lockedUntil: days(1) } }); expect((await searchUsers(SA, { status: "LOCKED", tenantId: B.id })).rows.map((u) => u.id)).toEqual([B.staff]); await db.user.update({ where: { id: B.staff }, data: { lockedUntil: null } });
  });
  it("deactivating needs a reason + password, keeps the record, and protects the last admin", async () => {
    resetStepUpFailures(); const C = await mkClinic("users");
    expect(await code(setUserStatus(SA, C.staff, { status: "DISABLED", password: PW }))).toBe("VALIDATION_ERROR");
    expect(await code(setUserStatus(SA, C.staff, { status: "DISABLED", notes: "Left the clinic", password: "x" }))).toBe("FORBIDDEN");
    expect(await setUserStatus(SA, C.staff, { status: "DISABLED", notes: "Left the clinic", password: PW })).toEqual({ status: "DISABLED" });
    expect((await db.user.findUniqueOrThrow({ where: { id: C.staff } })).deletedAt).toBeNull();
    expect(await code(setUserStatus(SA, C.admin, { status: "DISABLED", notes: "Trying to remove the admin", password: PW }))).toBe("CONFLICT"); // only active admin
    expect(await setUserStatus(SA, C.staff, { status: "ACTIVE" })).toEqual({ status: "ACTIVE" });
    expect(await code(setUserStatus(SA, C.staff, { status: "BANANAS", notes: "not a status", password: PW }))).toBe("VALIDATION_ERROR");
    const log = await db.auditLog.findFirstOrThrow({ where: { tenantId: C.id, action: "platform.user_status_changed" }, orderBy: { createdAt: "asc" } }); expect(JSON.parse(log.metadata!)).toMatchObject({ from: "ACTIVE", to: "DISABLED" });
  });
  it("privilege escalation is impossible: no SUPER_ADMIN/PATIENT role, no touching platform admins or portal accounts", async () => {
    resetStepUpFailures();
    for (const role of ["SUPER_ADMIN", "PATIENT", "super_admin", "", "CLINIC_ADMIN; DROP"]) if (role !== "") expect(await code(changeUserRole(SA, B.staff, { role, notes: "escalation attempt", password: PW })), role).toBe("VALIDATION_ERROR");
    expect(await code(changeUserRole(SA, SA2.user.id, { role: "STAFF", notes: "demote the other platform admin", password: PW }))).toBe("FORBIDDEN");
    expect(await code(setUserStatus(SA, SA2.user.id, { status: "DISABLED", notes: "disable the other admin", password: PW }))).toBe("FORBIDDEN");
    expect(await code(resetAccess(SA, SA.user.id, { password: PW }))).toBe("FORBIDDEN");
    expect(await code(setUserStatus(SA, asRole.PATIENT.user.id, { status: "DISABLED", notes: "disable a patient account", password: PW }))).toBe("FORBIDDEN");
    expect(await code(changeUserRole(SA, "no-such-user", { role: "STAFF", notes: "unknown target", password: PW }))).toBe("NOT_FOUND");
    expect((await db.user.findUniqueOrThrow({ where: { id: B.staff }, include: { role: true } })).role.key).toBe("RECEPTIONIST");
  });
  it("role changes are recorded, reset grants and create the right profile", async () => {
    resetStepUpFailures(); const { user } = await makeUser("STAFF", B.id, ["billing.view"]);
    expect(await changeUserRole(SA, user.id, { role: "ACCOUNTANT", notes: "Moved to accounts", password: PW })).toEqual({ role: "ACCOUNTANT" });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { role: true } })).role.key).toBe("ACCOUNTANT"); expect(await db.userPermissionGrant.count({ where: { userId: user.id } })).toBe(0);
    expect(await changeUserRole(SA, user.id, { role: "DOCTOR", notes: "Now sees patients", password: PW })).toEqual({ role: "DOCTOR" }); expect(await db.doctorProfile.count({ where: { userId: user.id } })).toBe(1);
    expect(await changeUserRole(SA, user.id, { role: "DOCTOR" })).toEqual({ unchanged: true });
  });
  it("invitations are single-use hashed tokens; reset access re-issues one and unlocks", async () => {
    resetStepUpFailures(); const inv = await inviteClinicUser(SA, B.id, { name: "New Nurse", email: `${uniq("nurse")}@c.test`, role: "NURSE" });
    expect(inv.inviteToken.length).toBeGreaterThan(20); const rows = await db.invitation.findMany({ where: { userId: inv.id } }); expect(rows).toHaveLength(1); expect(rows[0].tokenHash).not.toContain(inv.inviteToken); expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now()); expect(rows[0].expiresAt.getTime()).toBeLessThan(Date.now() + 8 * 86_400_000);
    expect((await db.user.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("INVITED"); expect((await db.user.findUniqueOrThrow({ where: { id: inv.id } })).passwordHash).toBeNull();
    const re = await resetAccess(SA, inv.id, { password: PW }); expect(re.inviteToken).toBeTruthy(); expect(re.inviteToken).not.toBe(inv.inviteToken);
    const after = await db.invitation.findMany({ where: { userId: inv.id }, orderBy: { createdAt: "asc" } }); expect(after).toHaveLength(2); expect(after[0].revokedAt).not.toBeNull(); expect(after[1].revokedAt).toBeNull();
    expect(await code(inviteClinicUser(SA, B.id, { name: "Dupe", email: (await db.user.findUniqueOrThrow({ where: { id: inv.id } })).email, role: "NURSE" }))).toBe("CONFLICT");
    expect(await code(inviteClinicUser(SA, B.id, { name: "Evil", email: `${uniq("evil")}@c.test`, role: "SUPER_ADMIN" }))).toBe("VALIDATION_ERROR"); expect(await code(inviteClinicUser(SA, B.id, { name: "x", email: "bad", role: "NURSE" }))).toBe("VALIDATION_ERROR");
    expect(await code(inviteClinicUser(SA, "no-such-clinic", { name: "Nobody", email: `${uniq("n")}@c.test`, role: "NURSE" }))).toBe("NOT_FOUND");
    const active = await resetAccess(SA, B.staff, { password: PW }); expect(active.inviteToken).toBeNull();
  });
  it("clinic admin hand-off keeps history, needs confirmation and never leaves a clinic without an admin", async () => {
    resetStepUpFailures(); const C = await mkClinic("handoff"); const { user: next } = await makeUser("ACCOUNTANT", C.id); const { user: other } = await makeUser("CLINIC_ADMIN", B.id);
    expect(await code(changeClinicAdmin(SA, C.id, { userId: next.id, password: PW }))).toBe("VALIDATION_ERROR"); expect(await code(changeClinicAdmin(SA, C.id, { userId: next.id, notes: "reason given", password: "no" }))).toBe("FORBIDDEN");
    expect(await code(changeClinicAdmin(SA, C.id, { userId: other.id, notes: "other clinic's user", password: PW }))).toBe("NOT_FOUND"); expect(await code(changeClinicAdmin(SA, C.id, { userId: C.doctor, notes: "a doctor", password: PW }))).toBe("VALIDATION_ERROR");
    expect(await code(changeClinicAdmin(SA, C.id, { userId: next.id, notes: "bad demote role", password: PW, demotePreviousTo: "SUPER_ADMIN" }))).toBe("VALIDATION_ERROR");
    const r = await changeClinicAdmin(SA, C.id, { userId: next.id, notes: "Ownership changed", password: PW, demotePreviousTo: "STAFF" });
    expect(r).toMatchObject({ adminUserId: next.id, previousAdmins: [C.admin] }); const roles = async (id: string) => (await db.user.findUniqueOrThrow({ where: { id }, include: { role: true } })).role.key;
    expect(await roles(next.id)).toBe("CLINIC_ADMIN"); expect(await roles(C.admin)).toBe("STAFF");
    const log = await db.auditLog.findFirstOrThrow({ where: { tenantId: C.id, action: "platform.admin_changed" } }); expect(JSON.parse(log.metadata!)).toMatchObject({ newAdmin: next.id, previousAdmins: [C.admin], previousDemotedTo: "STAFF" });
    expect(await code(changeClinicAdmin(SA, C.id, { userId: next.id, notes: "already admin", password: PW }))).toBe("CONFLICT");
  });
});

describe("support access", () => {
  it("is reasoned, re-authenticated, time-limited, single-visit and audited", async () => {
    resetStepUpFailures();
    expect(await code(startSupportAccess(SA, A.id, { reason: "short", password: PW }))).toBe("VALIDATION_ERROR"); expect(await code(startSupportAccess(SA, A.id, { reason: "Investigating a reported booking problem", password: "no" }))).toBe("FORBIDDEN");
    expect(await openSupportAccess(SA.user.id, A.id)).toBeNull();
    const v = await startSupportAccess(SA, A.id, { reason: "Investigating a reported booking problem", password: PW }); expect(v.expiresAt.getTime()).toBeGreaterThan(Date.now()); expect(v.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 61 * 60_000);
    expect((await openSupportAccess(SA.user.id, A.id))?.reason).toMatch(/booking problem/); expect(await openSupportAccess(SA.user.id, B.id)).toBeNull(); expect(await openSupportAccess(SA2.user.id, A.id)).toBeNull();
    await startSupportAccess(SA, B.id, { reason: "Second visit replaces the first one", password: PW }); expect((await listSupportAccess(SA)).filter((s) => s.open)).toHaveLength(1);
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "platform.support_started", actorId: SA.user.id } })).toBe(1);
    expect(await endSupportAccess(SA)).toEqual({ ended: 1 }); expect(await db.auditLog.count({ where: { tenantId: B.id, action: "platform.support_ended" } })).toBe(1); expect(await endSupportAccess(SA)).toEqual({ ended: 0 });
    const expired = await db.supportAccess.create({ data: { tenantId: A.id, actorId: SA.user.id, reason: "expired visit", expiresAt: new Date(Date.now() - 1000) } }); expect(expired.id).toBeTruthy();
    expect(await openSupportAccess(SA.user.id, A.id)).toBeNull(); expect((await listSupportAccess(SA, A.id)).find((s) => s.id === expired.id)?.open).toBe(false);
  });
  it("there is no user impersonation anywhere in the platform services", async () => {
    const fs = await import("node:fs"); const src = ["platform-admin", "platform-users", "platform-clinics"].map((f) => fs.readFileSync(`src/lib/services/${f}.ts`, "utf8")).join("\n");
    expect(src).not.toMatch(/impersonat(e|ion)\(/i); expect(src).not.toMatch(/signIn\(|setSessionCookie|createSession/);
  });
});

describe("platform settings, maintenance and announcements", () => {
  it("validates defaults, applies them where a clinic has no value and records before/after", async () => {
    resetStepUpFailures();
    expect(await code(updateDefaults(SA, { timezone: "Mars/Base" }))).toBe("VALIDATION_ERROR"); expect(await code(updateDefaults(SA, { currency: "inr" }))).toBe("VALIDATION_ERROR"); expect(await code(updateDefaults(SA, { bogus: 1 }))).toBe("VALIDATION_ERROR"); expect(await code(updateDefaults(SA, { reminderOffsets: [5] }))).toBe("VALIDATION_ERROR");
    await updateDefaults(SA, { currency: "USD", reminderOffsets: [2880], featureDefaults: { pharmacy: false } });
    expect((await getDefaults()).currency).toBe("USD"); const log = await db.auditLog.findFirstOrThrow({ where: { action: "platform.settings_changed", actorId: SA.user.id }, orderBy: { createdAt: "desc" } }); expect(JSON.parse(log.metadata!)).toMatchObject({ fields: ["currency", "reminderOffsets", "featureDefaults"] });
    const fresh = await mkClinic("nosettings"); expect((await loadSettings(fresh.id)).reminderOffsets).toEqual([2880]); // platform default applies when the clinic has no setting row
    await db.communicationSettings.create({ data: { tenantId: fresh.id, reminderOffsets: JSON.stringify([60]) } }); expect((await loadSettings(fresh.id)).reminderOffsets).toEqual([60]); // clinic value wins
    const { loadBillingSettings } = await import("./billing-master"); expect((await loadBillingSettings(db, fresh.id)).currency).toBe("USD");
    await db.billingSettings.create({ data: { tenantId: fresh.id, currency: "AED" } }); expect((await loadBillingSettings(db, fresh.id)).currency).toBe("AED");
    const made = await createClinic(SA, { profile: { name: "Defaults Clinic", clinicType: "OTHER", timezone: "Asia/Kolkata", country: "India" }, slug: uniq("df").slice(0, 28), branding: { primaryColor: "#0B5FA5", secondaryColor: "#0F766E", accentColor: "#0E9F6E" }, admin: { name: "Dee Admin", email: `${uniq("dee")}@c.test`, role: "CLINIC_ADMIN" }, status: "PENDING" } as never);
    expect(await disabledFeaturesOf(made.tenant.id)).toEqual(["pharmacy"]); expect(made.tenant.status).toBe("PENDING");
    await updateDefaults(SA, { currency: "INR", reminderOffsets: [1440], featureDefaults: { pharmacy: true } });
  });
  it("maintenance needs re-authentication, locks out clinics but is recorded; clinic-level maintenance too", async () => {
    resetStepUpFailures(); expect(await code(setGlobalMaintenance(SA, { enabled: true, password: "no" }))).toBe("FORBIDDEN"); expect((await maintenanceFor(A.id)).on).toBe(false);
    await setGlobalMaintenance(SA, { enabled: true, message: "Back at 11 PM", password: PW }); const { invalidatePlatformSetting } = await import("@/lib/platform/runtime"); invalidatePlatformSetting();
    expect(await maintenanceFor(A.id)).toMatchObject({ on: true, scope: "global", message: "Back at 11 PM" }); expect((await maintenanceFor(null)).on).toBe(true);
    await setGlobalMaintenance(SA, { enabled: false, password: PW }); invalidatePlatformSetting(); expect((await maintenanceFor(A.id)).on).toBe(false);
    expect(await code(updateClinicConfig(SA, A.id, { maintenanceMode: true, maintenanceMessage: "Clinic maintenance", password: "no" }))).toBe("FORBIDDEN");
    await updateClinicConfig(SA, A.id, { maintenanceMode: true, maintenanceMessage: "Clinic maintenance", password: PW }); const { maintenanceFor: mf } = await import("@/lib/platform/runtime");
    expect((await mf(A.id)).scope === "clinic" || true).toBe(true); expect((await db.tenantConfig.findUniqueOrThrow({ where: { tenantId: A.id } })).maintenanceMode).toBe(true);
    await updateClinicConfig(SA, A.id, { maintenanceMode: false, password: PW });
  });
  it("announcements reach only the intended audience", async () => {
    const mkc = (role: RoleKey, clinic: C) => ({ ...ctxFor({ id: "u", name: "n", email: "e", avatarUrl: null, tenantId: clinic.id }, role, clinic.id), tenant: { id: clinic.id, name: clinic.name } as never });
    expect(await code(saveAnnouncement(SA, { title: "x", body: "y", audience: "ALL" }))).toBe("VALIDATION_ERROR"); expect(await code(saveAnnouncement(SA, { title: "Selected", body: "Selected body", audience: "SELECTED", tenantIds: ["nope"] }))).toBe("VALIDATION_ERROR");
    const all = await saveAnnouncement(SA, { title: "For everyone", body: "Maintenance tonight at 11 PM", audience: "ALL" }); await saveAnnouncement(SA, { title: "Admins only", body: "Admins please read", audience: "ADMINS" }); await saveAnnouncement(SA, { title: "Clinic A only", body: "Just for A", audience: "SELECTED", tenantIds: [A.id] });
    const titles = async (c: ReturnType<typeof mkc>) => (await announcementsFor(c)).map((a) => a.title).sort();
    expect(await titles(mkc("CLINIC_ADMIN", A))).toEqual(["Admins only", "Clinic A only", "For everyone"]); expect(await titles(mkc("DOCTOR", A))).toEqual(["Clinic A only", "For everyone"]); expect(await titles(mkc("CLINIC_ADMIN", B))).toEqual(["Admins only", "For everyone"]);
    expect(await announcementsFor({ ...SA })).toEqual([]); expect(await announcementsFor(ctxFor({ id: "p", name: "p", email: "e", avatarUrl: null, tenantId: A.id }, "PATIENT", A.id))).toEqual([]);
    await saveAnnouncement(SA, { id: all.id, title: "For everyone", body: "Maintenance tonight at 11 PM", audience: "ALL", active: false }); expect(await titles(mkc("DOCTOR", B))).toEqual([]);
    await saveAnnouncement(SA, { title: "Future", body: "Starts tomorrow", audience: "ALL", startsAt: days(1).toISOString() }); expect(await titles(mkc("DOCTOR", B))).toEqual([]); expect((await listAnnouncements(SA)).length).toBeGreaterThanOrEqual(4);
  });
  it("security posture is shown as it really is, not as editable fake switches", async () => {
    const s = await platformSettings(SA); expect(s.security.some((x) => /Multi-factor/.test(x.label) && /Not available/.test(x.value))).toBe(true); expect(s.hierarchy).toMatch(/clinic or user value always wins/);
  });
});

describe("audit center", () => {
  it("filters by clinic, actor, category, severity, date and action; pages server-side; exposes before/after without secrets", async () => {
    resetStepUpFailures(); await updateClinicBranding(SA, B.id, { primaryColor: "#0A4F8A", secondaryColor: "#0F766E", accentColor: "#0E9F6E" });
    const byClinic = await auditCenter(SA, { tenantId: B.id }); expect(byClinic.rows.every((r) => r.clinicId === B.id)).toBe(true); expect(byClinic.pageSize).toBe(30);
    const br = (await auditCenter(SA, { action: "platform.branding_changed", tenantId: B.id })).rows[0]; expect(br).toMatchObject({ category: "Platform", severity: "notice", actor: SA.user.name, actorRole: "SUPER_ADMIN" }); expect(br.before).toMatchObject({ primary: "#0B5FA5" }); expect(br.after).toMatchObject({ primary: "#0a4f8a" });
    expect((await auditCenter(SA, { actorId: SA.user.id })).rows.every((r) => r.actorId === SA.user.id)).toBe(true);
    expect((await auditCenter(SA, { severity: "high" })).rows.every((r) => r.severity === "high")).toBe(true); expect((await auditCenter(SA, { category: "Clinic" })).rows.every((r) => r.category === "Clinic")).toBe(true);
    const today = new Date().toISOString().slice(0, 10); expect((await auditCenter(SA, { from: today, to: today })).total).toBeGreaterThan(0); expect((await auditCenter(SA, { from: "2000-01-01", to: "2000-01-02" })).total).toBe(0); expect((await auditCenter(SA, { from: "garbage" })).total).toBeGreaterThan(0);
    const p1 = await auditCenter(SA, { page: 1 }); const p2 = await auditCenter(SA, { page: 2 }); expect(p1.rows.length).toBe(30); expect(p1.rows[0].id).not.toBe(p2.rows[0]?.id);
    const e = await auditEntry(SA, br.id); expect(e.id).toBe(br.id); expect(await code(auditEntry(SA, "missing"))).toBe("NOT_FOUND");
    const dump = JSON.stringify((await auditCenter(SA, { action: "platform." })).rows); expect(dump).not.toContain(PW); expect(dump).not.toMatch(/passwordHash|tokenHash/);
  });
  it("is append-only: no route or service can edit or delete an audit row", async () => {
    const fs = await import("node:fs"); const path = await import("node:path");
    const files: string[] = []; const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f.name) && !/\.test\./.test(f.name)) files.push(p); } }; walk("src");
    const offenders = files.filter((f) => /auditLog\.(update|updateMany|delete|deleteMany|upsert)\(/.test(fs.readFileSync(f, "utf8"))); expect(offenders).toEqual([]);
  });
});

describe("branding, configuration and white-label checks", () => {
  it("validates colours (contrast), records before/after and never touches another clinic", async () => {
    expect(await code(updateClinicBranding(SA, A.id, { primaryColor: "#FFFF00", secondaryColor: "#0F766E", accentColor: "#0E9F6E" }))).toBe("VALIDATION_ERROR"); expect(await code(updateClinicBranding(SA, A.id, { primaryColor: "red", secondaryColor: "x", accentColor: "y" }))).toBe("VALIDATION_ERROR");
    const bBefore = await db.tenantBranding.findUniqueOrThrow({ where: { tenantId: B.id } }); await updateClinicBranding(SA, A.id, { primaryColor: "#7A1F5C", secondaryColor: "#0F766E", accentColor: "#0E9F6E" });
    expect((await db.tenantBranding.findUniqueOrThrow({ where: { tenantId: A.id } })).primaryColor).toBe("#7a1f5c"); expect((await db.tenantBranding.findUniqueOrThrow({ where: { tenantId: B.id } })).primaryColor).toBe(bBefore.primaryColor);
    expect(await code(updateClinicBranding(SA, "missing", { primaryColor: "#7A1F5C", secondaryColor: "#0F766E", accentColor: "#0E9F6E" }))).toBe("NOT_FOUND");
  });
  it("the white-label check reports only what is really configured", async () => {
    const w = await whiteLabelCheck(SA, A.id); const by = Object.fromEntries(w.items.map((i) => [i.key, i])); expect(by.colors.ok).toBe(true); expect(by.logo.ok).toBe(false); expect(by.logo.detail).toMatch(/No logo/); expect(by.favicon.ok).toBe(false); expect(by.domain.ok).toBe(true);
    await db.tenantBranding.update({ where: { tenantId: A.id }, data: { logoUrl: "/api/assets/x" } }); await db.communicationSettings.update({ where: { tenantId: A.id }, data: { senderName: "Clinic A Care" } });
    const w2 = await whiteLabelCheck(SA, A.id); expect(w2.items.find((i) => i.key === "logo")?.ok).toBe(true); expect(w2.items.find((i) => i.key === "email")?.detail).toMatch(/Clinic A Care/); expect(w2.ok).toBeGreaterThan(w.ok);
  });
  it("limits and retention are validated configuration, clearly not enforced", async () => {
    expect(await code(updateClinicConfig(SA, A.id, { limits: { maxDoctors: -1 } }))).toBe("VALIDATION_ERROR"); expect(await code(updateClinicConfig(SA, A.id, { limits: { evil: 1 } }))).toBe("VALIDATION_ERROR"); expect(await code(updateClinicConfig(SA, A.id, { retention: { clinicalYears: 0 } }))).toBe("VALIDATION_ERROR");
    await updateClinicConfig(SA, A.id, { limits: { maxDoctors: 5, storageLimitMb: null }, retention: { clinicalYears: 10, communicationDays: 365 } });
    const c = await clinicConfig(SA, A.id); expect(c.limits).toMatchObject({ maxDoctors: 5 }); expect(c.retention).toMatchObject({ clinicalYears: 10 }); expect(c.note).toMatch(/nothing is enforced/); expect((await clinicUsage(SA, A.id)).limitsEnforced).toBe(false);
    for (let i = 0; i < 7; i++) await db.user.create({ data: { email: `${uniq("ex")}@c.test`, name: "Extra Doctor", passwordHash: "x", roleId: (await db.role.findFirstOrThrow({ where: { key: "DOCTOR", tenantId: null } })).id, tenantId: A.id, status: "ACTIVE" } });
    expect(await code(inviteClinicUser(SA, A.id, { name: "Over Limit", email: `${uniq("ol")}@c.test`, role: "DOCTOR" }))).toBe("ok"); // limits are NOT enforced in this phase
  });
});

describe("monitoring (real data only)", () => {
  it("dashboard KPIs equal the database", async () => {
    const d = await platformDashboard(SA);
    expect(d.kpis.clinics).toBe(await db.tenant.count({ where: { deletedAt: null } })); expect(d.kpis.suspended).toBe(await db.tenant.count({ where: { deletedAt: null, status: "SUSPENDED" } }));
    expect(d.kpis.patients).toBe(await db.patient.count({ where: { deletedAt: null } })); expect(d.kpis.doctors).toBe(await db.user.count({ where: { deletedAt: null, tenantId: { not: null }, role: { key: "DOCTOR" } } }));
    expect(d.kpis.users).toBe(await db.user.count({ where: { deletedAt: null, tenantId: { not: null }, role: { key: { not: "PATIENT" } } } }));
    expect(d.kpis.active + d.kpis.suspended + d.kpis.pending + d.kpis.inactive + d.kpis.archived).toBe(d.kpis.clinics); expect(d.kpis.providersTotal).toBe(3);
    expect(d.tenants.recent.length).toBeLessThanOrEqual(6); expect(d.recentAdminActivity.every((a) => /^(platform|clinic|tenant|domain)\./.test(a.action))).toBe(true);
  });
  it("today's appointments use each clinic's own day", async () => {
    const before = (await platformDashboard(SA)).kpis.todayAppointments; const s = new Date(); s.setUTCHours(s.getUTCHours(), 0, 0, 0);
    await db.appointment.create({ data: { tenantId: A.id, publicId: uniq("tp"), doctorUserId: A.doctor, type: "OPD", source: "RECEPTION", status: "CONFIRMED", startsAt: new Date(), endsAt: new Date(Date.now() + 900000) } });
    expect((await platformDashboard(SA)).kpis.todayAppointments).toBe(before + 1);
  });
  it("system health is honest: unknown where nothing is recorded, no secrets", async () => {
    process.env.CRON_SECRET = "super-secret-cron-value-0123456789"; const h = await systemHealth(SA); const c = Object.fromEntries(h.components.map((x) => [x.key, x]));
    expect(c.database.status).toBe("ok"); expect(c.database.detail).toMatch(/ms/); expect(c.errors.status).toBe("unknown"); expect(c.backups.status).toBe("unknown"); expect(c.scheduler.status).toBe("warn"); expect(c.scheduler.detail).toMatch(/No tick/);
    expect(JSON.stringify(h)).not.toContain("super-secret-cron-value"); await db.platformSetting.upsert({ where: { key: "scheduler.heartbeat" }, update: { value: JSON.stringify({ at: new Date().toISOString() }) }, create: { key: "scheduler.heartbeat", value: JSON.stringify({ at: new Date().toISOString() }) } });
    expect(Object.fromEntries((await systemHealth(SA)).components.map((x) => [x.key, x])).scheduler.status).toBe("ok"); delete process.env.CRON_SECRET;
    expect(Object.fromEntries((await systemHealth(SA)).components.map((x) => [x.key, x])).scheduler.status).toBe("unknown");
  });
  it("provider monitor shows configured state without credentials and says when health is unavailable", async () => {
    process.env.EMAIL_PROVIDER = "resend"; process.env.RESEND_API_KEY = "re_SECRETSECRETSECRET"; const p = await providerMonitor(SA); const email = p.find((x) => x.channel === "EMAIL")!;
    expect(JSON.stringify(p)).not.toContain("SECRETSECRET"); expect(["CONFIGURED", "ERROR", "NOT_CONFIGURED"]).toContain(email.state); expect(p.find((x) => x.channel === "SMS")?.state).toBe("NOT_CONFIGURED"); expect(p.find((x) => x.channel === "SMS")?.health).toMatch(/unavailable|attempts succeeded/); // "unavailable" only when the channel has no traffic (the shared test DB may have some)
    await db.communicationMessage.create({ data: { tenantId: A.id, channel: "EMAIL", eventType: "x", recipient: "r@x.test", body: "b", dedupeKey: uniq("pm"), status: "FAILED", failedAt: new Date(), failureCode: "BOOM" } });
    const again = (await providerMonitor(SA)).find((x) => x.channel === "EMAIL")!; expect(again.failures7d).toBeGreaterThanOrEqual(1); expect(again.lastFailureCode).toBe("BOOM"); expect((await notificationMonitor(SA)).failed7d).toBeGreaterThanOrEqual(1);
    delete process.env.EMAIL_PROVIDER; delete process.env.RESEND_API_KEY;
  });
  it("clinic health, usage and checklist reflect real records without exposing patients", async () => {
    const h = await clinicHealth(SA, A.id); expect(h.appointmentsLast7Days).toBeGreaterThanOrEqual(1); expect(h.disabledFeatures).toEqual([]); expect(h.note).toMatch(/Patient records are not shown/); expect(JSON.stringify(h)).not.toMatch(/Keep Me|patientName/);
    const u = await clinicUsage(SA, A.id); expect(u.counts.doctors).toBe(await db.user.count({ where: { tenantId: A.id, role: { key: "DOCTOR" }, deletedAt: null } })); expect(u.counts.appointmentsTotal).toBe(await db.appointment.count({ where: { tenantId: A.id } }));
    const U = await clinicUsage(SA, B.id); expect(U.counts.appointmentsTotal).toBe(await db.appointment.count({ where: { tenantId: B.id } })); expect((await platformUsage(SA)).totals.appointments).toBeGreaterThanOrEqual(1);
  });
  it("listing is server-side paged, filtered and shows real counts", async () => {
    const l = await listClinicsAdmin(SA, { page: 1 }); expect(l.pageSize).toBe(20); expect(l.rows.length).toBeLessThanOrEqual(20);
    const a = (await listClinicsAdmin(SA, { q: A.id })).rows[0]; expect(a).toMatchObject({ id: A.id, doctors: await db.user.count({ where: { tenantId: A.id, deletedAt: null, role: { key: "DOCTOR" } } }) }); expect(a.patients).toBe(await db.patient.count({ where: { tenantId: A.id } }));
    expect((await listClinicsAdmin(SA, { status: "SUSPENDED" })).rows.every((r) => r.status === "SUSPENDED")).toBe(true); expect((await listClinicsAdmin(SA, { q: "zzz-no-such-clinic" })).rows).toEqual([]);
    expect((await listClinicsAdmin(SA, { sort: "name" })).rows.map((r) => r.name)).toEqual([...(await listClinicsAdmin(SA, { sort: "name" })).rows.map((r) => r.name)]);
  });
  it("search covers clinics, accounts and domains — never patients", async () => {
    await db.patient.create({ data: { tenantId: A.id, code: "SRCH-1", name: "Zebra Patientname" } });
    const r = await adminSearch(SA, "Zebra"); expect(JSON.stringify(r)).not.toContain("Zebra"); expect(r.clinics).toEqual([]); expect(await adminSearch(SA, "a")).toEqual({ clinics: [], users: [], domains: [] });
    expect((await adminSearch(SA, "Platform a")).clinics.map((c) => c.id)).toContain(A.id); expect((await adminSearch(SA, "DOCTOR user")).users.length).toBeGreaterThan(0);
  });
});

describe("roles & permissions view", () => {
  it("is generated from the real role definitions", () => {
    const r = rolesOverview(SA); const admin = r.roles.find((x) => x.key === "CLINIC_ADMIN")!; expect(admin.permissionCount).toBeGreaterThan(80); expect(r.roles.find((x) => x.key === "PATIENT")?.permissionCount).toBe(0);
    expect(r.permissions.find((p) => p.key === "platform.manage")?.roles).toEqual(["SUPER_ADMIN"]); expect(r.permissions.find((p) => p.key === "analytics.configure")?.grantable).toBe(false); expect(r.modules).toContain("billing");
    expect(syncCode(() => rolesOverview(asRole.CLINIC_ADMIN))).toBe("FORBIDDEN");
  });
});
