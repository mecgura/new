/**
 * PRODUCTION bootstrap. Creates ONLY system data and (optionally) the first Super Admin. No demo clinics, users, patients, plans or content.
 * Safe to re-run: it upserts the permission catalogue and refreshes the grants of the system roles, and never touches clinic data.
 *
 *   BOOTSTRAP_SUPERADMIN_EMAIL=you@yourcompany.com BOOTSTRAP_SUPERADMIN_PASSWORD='<16+ chars>' npm run db:seed:production
 *
 * The first Super Admin is only created when no Super Admin exists yet. Two-factor sign-in is switched on for the Super Admin role
 * (they are sent to Account security to enrol at first sign-in). Change the password after first sign-in and remove the variables.
 * Real plans and prices are created by the Super Admin in the console — nothing is pre-filled.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { PERMISSIONS, ROLES, ROLE_LABELS, ROLE_PERMISSIONS } from "../src/lib/permissions";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required."); process.exit(1); }
const db = new PrismaClient({ adapter: url.startsWith("postgres") ? new PrismaPg({ connectionString: url }, process.env.DATABASE_SCHEMA ? { schema: process.env.DATABASE_SCHEMA } : undefined) : new PrismaBetterSqlite3({ url }) });

async function main() {
  for (const [key, meta] of Object.entries(PERMISSIONS)) await db.permission.upsert({ where: { key }, update: { module: meta.module, description: meta.description }, create: { key, module: meta.module, description: meta.description } });
  const perms = new Map((await db.permission.findMany()).map((p) => [p.key, p.id]));
  const roleIds = new Map<string, string>();
  for (const key of ROLES) {
    const existing = await db.role.findFirst({ where: { key, tenantId: null } });
    const role = existing ?? (await db.role.create({ data: { key, name: ROLE_LABELS[key], isSystem: true } }));
    roleIds.set(key, role.id);
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({ data: ROLE_PERMISSIONS[key].map((p) => ({ roleId: role.id, permissionId: perms.get(p)! })) });
  }
  await db.permission.deleteMany({ where: { key: { notIn: Object.keys(PERMISSIONS) } } });
  console.log(`System data ready: ${perms.size} permissions, ${ROLES.length} roles.`);

  const email = (process.env.BOOTSTRAP_SUPERADMIN_EMAIL ?? "").trim().toLowerCase(); const password = process.env.BOOTSTRAP_SUPERADMIN_PASSWORD ?? "";
  const existingAdmin = await db.user.count({ where: { roleId: roleIds.get("SUPER_ADMIN")!, deletedAt: null } });
  if (existingAdmin > 0) console.log("A Super Admin already exists — none created.");
  else if (!email && !password) console.log("No BOOTSTRAP_SUPERADMIN_* variables set — no Super Admin created. Set them and run again to create the first one.");
  else {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error("BOOTSTRAP_SUPERADMIN_EMAIL is not a valid email."); process.exit(1); }
    if (password.length < 16) { console.error("BOOTSTRAP_SUPERADMIN_PASSWORD must be at least 16 characters."); process.exit(1); }
    if (/demo|password/i.test(password)) { console.error("Choose a password that does not contain 'demo' or 'password'."); process.exit(1); }
    await db.user.create({ data: { email, name: "Platform Super Admin", passwordHash: await bcrypt.hash(password, 12), tenantId: null, roleId: roleIds.get("SUPER_ADMIN")! } });
    console.log(`First Super Admin created: ${email}`);
  }
  // Two-factor for the Super Admin role is on by default in a production install.
  const KEY = "security.policy"; const cur = await db.platformSetting.findUnique({ where: { key: KEY } });
  let policy: { mfaRequiredRoles?: string[] } = {}; try { policy = cur ? JSON.parse(cur.value) : {}; } catch { policy = {}; }
  const roles = new Set(policy.mfaRequiredRoles ?? []); if (!roles.has("SUPER_ADMIN")) {
    roles.add("SUPER_ADMIN"); const value = JSON.stringify({ ...policy, mfaRequiredRoles: [...roles] });
    await db.platformSetting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } }); console.log("Two-factor required for the Super Admin role.");
  }
}
main().catch((e) => { console.error("Production seed failed:", e instanceof Error ? e.message : e); process.exit(1); }).finally(() => db.$disconnect());
