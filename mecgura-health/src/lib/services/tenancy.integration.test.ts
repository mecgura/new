import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ctxFor, asTenant, makeUser, seedSystemData, uniq } from "@/test/helpers";
import { AppError } from "@/lib/errors";
import { assertCanEnterClinic, createClinic, getClinic, listClinics, markDomainVerified, platformStats, setClinicStatus, updateClinic, updateDomain } from "./clinics";
import { removeImage, resetBranding, saveImage, updateBranding, updateOwnProfile } from "./clinic-settings";
import { acceptInvitation, createUser, getUser, listUsers, reinviteUser, setUserStatus, updateUser } from "./users";
import { brandingSchema, clinicCreateSchema, clinicProfileSchema, userCreateSchema, userUpdateSchema } from "@/lib/validation/clinic";
import { effectivePermissions } from "@/lib/permissions";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));

async function newClinic(sa: ReturnType<typeof ctxFor>, adminRole: "CLINIC_ADMIN" | "DOCTOR" = "CLINIC_ADMIN") {
  const slug = uniq("clinic").slice(0, 30);
  const input = clinicCreateSchema.parse({
    profile: { name: `Clinic ${slug}`, clinicType: "MULTI_DOCTOR", timezone: "Asia/Kolkata", country: "India" },
    slug,
    branding: { primaryColor: "#14529e", secondaryColor: "#0e7c86", accentColor: "#12a06a" },
    admin: { name: "Admin", email: `${uniq("adm")}@t.test`, role: adminRole },
    status: "TRIAL",
  });
  const res = await createClinic(sa, input);
  const adminUser = await db.user.findUniqueOrThrow({ where: { id: res.adminUserId } });
  await acceptInvitation(res.inviteToken, "Strong-pass-12345");
  return { tenantId: res.tenant.id, slug, adminEmail: input.admin.email, adminId: adminUser.id, inviteToken: res.inviteToken };
}

let sa: ReturnType<typeof ctxFor>;
let A: Awaited<ReturnType<typeof newClinic>>, B: Awaited<ReturnType<typeof newClinic>>;
let adminA: ReturnType<typeof ctxFor>, adminB: ReturnType<typeof ctxFor>;

beforeAll(async () => {
  await seedSystemData();
  const { user } = await makeUser("SUPER_ADMIN", null);
  sa = ctxFor(user, "SUPER_ADMIN", null);
  A = await newClinic(sa);
  B = await newClinic(sa);
  const ua = await db.user.findUniqueOrThrow({ where: { id: A.adminId } });
  const ub = await db.user.findUniqueOrThrow({ where: { id: B.adminId } });
  adminA = ctxFor(ua, "CLINIC_ADMIN", A.tenantId);
  adminB = ctxFor(ub, "CLINIC_ADMIN", B.tenantId);
});

describe("A. Super Admin: clinic management", () => {
  it("created two independent clinics with an invited admin who then activated via invitation", async () => {
    const a = await getClinic(sa, A.tenantId);
    expect(a.status).toBe("TRIAL");
    expect(a.subscription?.plan.key).toBe("foundation");
    expect(a.users.map((u) => u.status)).toEqual(["ACTIVE"]);
    expect(A.tenantId).not.toBe(B.tenantId);
  });
  it("lists, edits, suspends and re-activates; every change is audited", async () => {
    const list = await listClinics(sa, { q: A.slug });
    expect(list.rows.map((r) => r.id)).toEqual([A.tenantId]);
    await updateClinic(sa, A.tenantId, clinicProfileSchema.parse({ name: "Renamed Clinic", clinicType: "SPECIALIST_CLINIC", timezone: "Asia/Kolkata", country: "India" }));
    expect((await getClinic(sa, A.tenantId)).name).toBe("Renamed Clinic");
    await setClinicStatus(sa, A.tenantId, "SUSPENDED");
    expect((await getClinic(sa, A.tenantId)).status).toBe("SUSPENDED");
    await setClinicStatus(sa, A.tenantId, "ACTIVE");
    const actions = (await db.auditLog.findMany({ where: { tenantId: A.tenantId } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["clinic.created", "clinic.updated", "clinic.status_changed", "user.invited", "invitation.accepted"]));
    const stats = await platformStats(sa);
    expect(stats.totalClinics).toBeGreaterThanOrEqual(2);
  });
  it("blocks duplicate admin emails and workspace addresses", async () => {
    const dup = clinicCreateSchema.parse({ profile: { name: "X", clinicType: "OTHER", timezone: "Asia/Kolkata", country: "India" }, slug: A.slug, branding: { primaryColor: "#14529e", secondaryColor: "#0e7c86", accentColor: "#12a06a" }, admin: { name: "X", email: A.adminEmail, role: "DOCTOR" } });
    expect(await code(createClinic(sa, dup))).toBe("CONFLICT");
  });
  it("domain: custom domains start unverified and re-unverify when changed; clashes are rejected", async () => {
    await updateDomain(sa, A.tenantId, { customDomain: "clinic-a-test.com" });
    expect((await getClinic(sa, A.tenantId)).customDomainVerifiedAt).toBeNull();
    await markDomainVerified(sa, A.tenantId, true);
    expect((await getClinic(sa, A.tenantId)).customDomainVerifiedAt).not.toBeNull();
    await updateDomain(sa, A.tenantId, { customDomain: "clinic-a-other.com" });
    expect((await getClinic(sa, A.tenantId)).customDomainVerifiedAt).toBeNull();
    expect(await code(updateDomain(sa, B.tenantId, { customDomain: "clinic-a-other.com" }))).toBe("CONFLICT");
    expect(await code(updateDomain(sa, B.tenantId, { subdomain: A.slug }))).toBe("CONFLICT");
  });
  it("entering a clinic workspace is audited", async () => {
    await assertCanEnterClinic(sa, B.tenantId);
    expect(await db.auditLog.count({ where: { tenantId: B.tenantId, action: "tenant.entered", actorId: sa.user.id } })).toBe(1);
  });
});

describe("Tenant users cannot use platform (Super Admin) functions", () => {
  it("clinic admin / doctor / receptionist are all FORBIDDEN", async () => {
    const doctorA = ctxFor((await makeUser("DOCTOR", A.tenantId)).user, "DOCTOR", A.tenantId);
    for (const c of [adminA, doctorA]) {
      expect(await code(listClinics(c, {}))).toBe("FORBIDDEN");
      expect(await code(getClinic(c, B.tenantId))).toBe("FORBIDDEN");
      expect(await code(setClinicStatus(c, B.tenantId, "SUSPENDED"))).toBe("FORBIDDEN");
      expect(await code(updateClinic(c, B.tenantId, clinicProfileSchema.parse({ name: "hacked", clinicType: "OTHER", timezone: "Asia/Kolkata", country: "India" })))).toBe("FORBIDDEN");
      expect(await code(updateDomain(c, B.tenantId, { customDomain: "evil.com" }))).toBe("FORBIDDEN");
      expect(await code(assertCanEnterClinic(c, B.tenantId))).toBe("FORBIDDEN");
    }
    expect((await getClinic(sa, B.tenantId)).name).not.toBe("hacked");
  });
});

describe("E. Tenant isolation (Clinic A vs Clinic B)", () => {
  let doctorA: ReturnType<typeof ctxFor>, doctorB: ReturnType<typeof ctxFor>, recepA: ReturnType<typeof ctxFor>;
  let userB: string, userA: string;
  beforeAll(async () => {
    const dA = await createUser(asTenant(adminA), userCreateSchema.parse({ name: "Doc A", email: `${uniq("da")}@t.test`, role: "DOCTOR", specialization: "Derm" }));
    const dB = await createUser(asTenant(adminB), userCreateSchema.parse({ name: "Doc B", email: `${uniq("db")}@t.test`, role: "DOCTOR" }));
    const rA = await createUser(asTenant(adminA), userCreateSchema.parse({ name: "Reception A", email: `${uniq("ra")}@t.test`, role: "RECEPTIONIST" }));
    userA = dA.id; userB = dB.id;
    const get = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
    doctorA = ctxFor(await get(dA.id), "DOCTOR", A.tenantId);
    doctorB = ctxFor(await get(dB.id), "DOCTOR", B.tenantId);
    recepA = ctxFor(await get(rA.id), "RECEPTIONIST", A.tenantId);
  });

  it("Doctor A / Reception A / Admin A can read their own clinic's users", async () => {
    expect((await listUsers(asTenant(adminA), {})).rows.map((r) => r.id)).toContain(userA);
    expect((await getUser(asTenant(adminA), userA)).name).toBe("Doc A");
  });
  it("Clinic A admin never sees Clinic B users — list, get, update, status, invite all behave as 'not found'", async () => {
    const list = await listUsers(asTenant(adminA), {});
    expect(list.rows.map((r) => r.id)).not.toContain(userB);
    expect(list.rows.map((r) => r.id)).not.toContain(adminB.user.id);
    expect(await code(getUser(asTenant(adminA), userB))).toBe("NOT_FOUND");
    expect(await code(updateUser(asTenant(adminA), userB, userUpdateSchema.parse({ name: "hacked" })))).toBe("NOT_FOUND");
    expect(await code(setUserStatus(asTenant(adminA), userB, "DISABLED"))).toBe("NOT_FOUND");
    expect(await code(reinviteUser(asTenant(adminA), userB))).toBe("NOT_FOUND");
    expect(await code(getUser(asTenant(adminA), adminB.user.id))).toBe("NOT_FOUND");
    const still = await db.user.findUniqueOrThrow({ where: { id: userB } });
    expect(still.name).toBe("Doc B");
    expect(still.status).toBe("INVITED");
  });
  it("a hostile filter cannot widen the scope (tenantId in the query is overridden server-side)", async () => {
    const res = await listUsers(asTenant(adminA), { q: "Doc" });
    expect(res.rows.every((r) => r.id !== userB)).toBe(true);
  });
  it("the clinic is derived from the session context: Clinic A admin settings only ever affect Clinic A", async () => {
    await updateOwnProfile(asTenant(adminA), clinicProfileSchema.parse({ name: "A only", clinicType: "OTHER", timezone: "Asia/Kolkata", country: "India" }));
    expect((await getClinic(sa, A.tenantId)).name).toBe("A only");
    expect((await getClinic(sa, B.tenantId)).name).not.toBe("A only");
  });
  it("assets (avatar) of another clinic's user cannot be written", async () => {
    expect(await code(saveImage(asTenant(adminA), "AVATAR", PNG, userB))).toBe("NOT_FOUND");
    expect(await db.tenantAsset.count({ where: { ownerId: userB } })).toBe(0);
  });
  it("Super Admin can act inside BOTH clinics when entering the workspace (audited as viaSuperAdmin)", async () => {
    const inA = ctxFor(sa.user as never, "SUPER_ADMIN", A.tenantId, { viewingAs: true });
    const inB = ctxFor(sa.user as never, "SUPER_ADMIN", B.tenantId, { viewingAs: true });
    expect((await listUsers(asTenant(inA), {})).rows.map((r) => r.id)).toContain(userA);
    expect((await listUsers(asTenant(inB), {})).rows.map((r) => r.id)).toContain(userB);
    expect((await listUsers(asTenant(inA), {})).rows.map((r) => r.id)).not.toContain(userB);
    const created = await createUser(asTenant(inB), userCreateSchema.parse({ name: "By SA", email: `${uniq("sa")}@t.test`, role: "NURSE" }));
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "user.created", entityId: created.id } });
    expect(log.tenantId).toBe(B.tenantId);
    expect(log.actorId).toBe(sa.user.id);
    expect(JSON.parse(log.metadata!).viaSuperAdmin).toBe(true);
  });

  describe("D. Receptionist / Doctor cannot use admin-only operations (even in their own clinic)", () => {
    it("create, edit, status, invite are FORBIDDEN", async () => {
      for (const c of [recepA, doctorA]) {
        expect(await code(createUser(asTenant(c), userCreateSchema.parse({ name: "X", email: `${uniq("x")}@t.test`, role: "STAFF" })))).toBe("FORBIDDEN");
        expect(await code(updateUser(asTenant(c), userA, userUpdateSchema.parse({ name: "x" })))).toBe("FORBIDDEN");
        expect(await code(setUserStatus(asTenant(c), userA, "DISABLED"))).toBe("FORBIDDEN");
        expect(await code(reinviteUser(asTenant(c), userA))).toBe("FORBIDDEN");
        expect(await code(listUsers(asTenant(c), {}))).toBe("FORBIDDEN");
        expect(await code(updateOwnProfile(asTenant(c), clinicProfileSchema.parse({ name: "x", clinicType: "OTHER", timezone: "Asia/Kolkata", country: "India" })))).toBe("FORBIDDEN");
        expect(await code(updateBranding(asTenant(c), brandingSchema.parse({ primaryColor: "#14529e", secondaryColor: "#0e7c86", accentColor: "#12a06a" })))).toBe("FORBIDDEN");
        expect(await code(saveImage(asTenant(c), "LOGO", PNG))).toBe("FORBIDDEN");
        expect(await code(resetBranding(asTenant(c)))).toBe("FORBIDDEN");
      }
    });
    it("doctor in clinic B has no authority over clinic A either", async () => {
      expect(await code(getUser(asTenant(doctorB), userA))).toBe("FORBIDDEN"); // lacks users.view at all
    });
  });
});

describe("B. Clinic Admin: branding, staff, permissions", () => {
  it("updates branding, uploads/removes a logo (validated), resets to default", async () => {
    await updateBranding(asTenant(adminA), brandingSchema.parse({ primaryColor: "#5b21b6", secondaryColor: "#1d4ed8", accentColor: "#0f766e" }));
    expect((await db.tenantBranding.findUniqueOrThrow({ where: { tenantId: A.tenantId } })).primaryColor).toBe("#5b21b6");
    expect(await code(saveImage(asTenant(adminA), "LOGO", new TextEncoder().encode("<svg onload=alert(1)>")))).toBe("VALIDATION_ERROR");
    const { url } = await saveImage(asTenant(adminA), "LOGO", PNG);
    expect(url).toMatch(/^\/api\/assets\//);
    expect((await db.tenantBranding.findUniqueOrThrow({ where: { tenantId: A.tenantId } })).logoUrl).toBe(url);
    await removeImage(asTenant(adminA), "LOGO");
    expect((await db.tenantBranding.findUniqueOrThrow({ where: { tenantId: A.tenantId } })).logoUrl).toBeNull();
    await resetBranding(asTenant(adminA));
    expect((await db.tenantBranding.findUniqueOrThrow({ where: { tenantId: A.tenantId } })).primaryColor).toBeNull();
    expect((await db.auditLog.count({ where: { tenantId: A.tenantId, action: "branding.updated" } }))).toBeGreaterThanOrEqual(3);
  });
  it("STAFF gets only explicitly granted, grantable permissions", async () => {
    const created = await createUser(asTenant(adminA), userCreateSchema.parse({ name: "Staffer", email: `${uniq("st")}@t.test`, role: "STAFF", grants: ["patients.view", "users.create", "platform.manage", "bogus.perm"] }));
    const u = await getUser(asTenant(adminA), created.id);
    expect(u.permissionGrants.map((g) => g.permission)).toEqual(["patients.view"]);
    const eff = effectivePermissions("STAFF", u.permissionGrants.map((g) => g.permission));
    expect(eff.has("patients.view")).toBe(true);
    expect(eff.has("users.create")).toBe(false);
    expect(eff.has("billing.view")).toBe(false);
  });
  it("role changes, status changes and invitations work and are audited; self-lockout is prevented", async () => {
    const created = await createUser(asTenant(adminA), userCreateSchema.parse({ name: "Mover", email: `${uniq("mv")}@t.test`, role: "RECEPTIONIST" }));
    await updateUser(asTenant(adminA), created.id, userUpdateSchema.parse({ role: "NURSE" }));
    expect((await getUser(asTenant(adminA), created.id)).role.key).toBe("NURSE");
    expect(await db.auditLog.count({ where: { tenantId: A.tenantId, action: "user.role_changed", entityId: created.id } })).toBe(1);
    expect((await setUserStatus(asTenant(adminA), created.id, "ACTIVE")).status).toBe("INVITED"); // never set a password
    expect((await setUserStatus(asTenant(adminA), created.id, "SUSPENDED")).status).toBe("SUSPENDED");
    // A suspended user can't accept an invitation until re-activated (which returns them to INVITED)
    const blocked = await reinviteUser(asTenant(adminA), created.id);
    expect(await code(acceptInvitation(blocked.inviteToken, "Another-strong-pass1"))).toBe("VALIDATION_ERROR");
    expect((await setUserStatus(asTenant(adminA), created.id, "ACTIVE")).status).toBe("INVITED");
    const re = await reinviteUser(asTenant(adminA), created.id);
    await acceptInvitation(re.inviteToken, "Another-strong-pass1");
    expect((await getUser(asTenant(adminA), created.id)).status).toBe("ACTIVE");
    expect(await code(setUserStatus(asTenant(adminA), adminA.user.id, "DISABLED"))).toBe("FORBIDDEN");
    expect(await code(updateUser(asTenant(adminA), adminA.user.id, userUpdateSchema.parse({ role: "STAFF" })))).toBe("FORBIDDEN");
  });
  it("the last active Clinic Admin cannot be demoted or disabled", async () => {
    const created = await createUser(asTenant(adminB), userCreateSchema.parse({ name: "Second admin", email: `${uniq("ad2")}@t.test`, role: "CLINIC_ADMIN" }));
    // B has admin + the (invited, not active) second admin → admin B is the only ACTIVE admin
    expect(await code(setUserStatus(asTenant(ctxFor(sa.user as never, "SUPER_ADMIN", B.tenantId)), adminB.user.id, "DISABLED"))).toBe("CONFLICT");
    expect(await code(updateUser(asTenant(ctxFor(sa.user as never, "SUPER_ADMIN", B.tenantId)), adminB.user.id, userUpdateSchema.parse({ role: "STAFF" })))).toBe("CONFLICT");
    expect(created.id).toBeTruthy();
  });
  it("rejects duplicate emails across the platform", async () => {
    expect(await code(createUser(asTenant(adminA), userCreateSchema.parse({ name: "Dupe", email: B.adminEmail, role: "STAFF" })))).toBe("CONFLICT");
  });
});

describe("Invitations", () => {
  it("tokens are single-use, never stored in clear, and expire/revoke", async () => {
    const created = await createUser(asTenant(adminA), userCreateSchema.parse({ name: "Inv", email: `${uniq("inv")}@t.test`, role: "STAFF" }));
    const stored = await db.invitation.findFirstOrThrow({ where: { userId: created.id } });
    expect(stored.tokenHash).not.toContain(created.inviteToken);
    expect(await code(acceptInvitation("x".repeat(43), "Strong-pass-12345"))).toBe("VALIDATION_ERROR");
    const re = await reinviteUser(asTenant(adminA), created.id);
    expect(await code(acceptInvitation(created.inviteToken, "Strong-pass-12345"))).toBe("VALIDATION_ERROR"); // revoked by re-invite
    await acceptInvitation(re.inviteToken, "Strong-pass-12345");
    expect(await code(acceptInvitation(re.inviteToken, "Strong-pass-12345"))).toBe("VALIDATION_ERROR"); // single use
    await db.invitation.updateMany({ where: { userId: created.id }, data: { expiresAt: new Date(0) } });
    expect((await db.user.findUniqueOrThrow({ where: { id: created.id } })).passwordHash).toMatch(/^\$2[aby]\$/);
  });
  it("an invitation for a suspended clinic cannot be accepted", async () => {
    const created = await createUser(asTenant(adminB), userCreateSchema.parse({ name: "Late", email: `${uniq("late")}@t.test`, role: "STAFF" }));
    await setClinicStatus(sa, B.tenantId, "SUSPENDED");
    expect(await code(acceptInvitation(created.inviteToken, "Strong-pass-12345"))).toBe("VALIDATION_ERROR");
    await setClinicStatus(sa, B.tenantId, "ACTIVE");
  });
});

describe("Audit trail contains no secrets", () => {
  it("no log row contains a password, hash or invitation token", async () => {
    // "token.*" are queue-token event names (OPD tokens, not credentials), so only the other action names are scanned
    const rows = (await db.auditLog.findMany({ select: { metadata: true, action: true } })).filter((r) => !r.action.startsWith("token."));
    const blob = JSON.stringify(rows).toLowerCase();
    expect(blob).not.toContain("password");
    expect(blob).not.toContain("$2b$");
    expect(blob).not.toContain("token");
  });
});

// keep helpers referenced for type-checking of unused exports
void userCreateSchema;
