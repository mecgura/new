/**
 * Development seed: system roles + permissions + a clearly-marked DEMO clinic.
 * Refuses to run in production. Demo users hold no real data; demo tenant has isDemo=true.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { MODULE_KEYS } from "../src/config/modules";
import { PERMISSIONS, ROLES, ROLE_LABELS, ROLE_PERMISSIONS } from "../src/lib/permissions";

if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const db = new PrismaClient({ adapter: url.startsWith("postgres") ? new PrismaPg({ connectionString: url }) : new PrismaBetterSqlite3({ url }) });

async function main() {
  // Permission catalogue
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, update: { module: meta.module, description: meta.description }, create: { key, module: meta.module, description: meta.description } });
  }
  const perms = new Map((await db.permission.findMany()).map((p) => [p.key, p.id]));

  // System roles (tenantId null) + grants. Prisma can't upsert on a nullable compound key, so find-or-create.
  const roleIds = new Map<string, string>();
  for (const key of ROLES) {
    const existing = await db.role.findFirst({ where: { key, tenantId: null } });
    const role = existing ?? (await db.role.create({ data: { key, name: ROLE_LABELS[key], isSystem: true } }));
    roleIds.set(key, role.id);
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({ data: ROLE_PERMISSIONS[key].map((p) => ({ roleId: role.id, permissionId: perms.get(p)! })) });
  }

  // Plans
  const demoPlan = await db.plan.upsert({ where: { key: "demo-all-modules" }, update: { modules: JSON.stringify(MODULE_KEYS) }, create: { key: "demo-all-modules", name: "Demo (all modules)", modules: JSON.stringify(MODULE_KEYS) } });
  await db.plan.upsert({ where: { key: "foundation" }, update: {}, create: { key: "foundation", name: "Foundation", modules: JSON.stringify(["dashboard", "settings"]) } });

  // DEMO tenant
  const tenant = await db.tenant.upsert({
    where: { slug: "demo-clinic" },
    update: {},
    create: { name: "Demo Clinic", slug: "demo-clinic", subdomain: "demo", isDemo: true, contactEmail: "contact@demo.mecgura.test", contactPhone: null, address: null },
  });
  await db.tenantBranding.upsert({ where: { tenantId: tenant.id }, update: {}, create: { tenantId: tenant.id } });
  await db.subscription.upsert({ where: { tenantId: tenant.id }, update: { planId: demoPlan.id }, create: { tenantId: tenant.id, planId: demoPlan.id, status: "TRIAL" } });

  const generated = !process.env.SEED_DEMO_PASSWORD;
  const password = process.env.SEED_DEMO_PASSWORD || `Demo-${randomBytes(6).toString("hex")}1`;
  const passwordHash = await bcrypt.hash(password, 12);
  const users = [
    { email: "admin@demo.mecgura.test", name: "Demo Clinic Admin", role: "CLINIC_ADMIN", tenantId: tenant.id },
    { email: "doctor@demo.mecgura.test", name: "Demo Doctor", role: "DOCTOR", tenantId: tenant.id },
    { email: "reception@demo.mecgura.test", name: "Demo Receptionist", role: "RECEPTIONIST", tenantId: tenant.id },
    { email: "platform@demo.mecgura.test", name: "Demo Platform Admin", role: "SUPER_ADMIN", tenantId: null },
  ];
  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      update: { passwordHash, status: "ACTIVE", failedLoginCount: 0, lockedUntil: null, deletedAt: null },
      create: { email: u.email, name: u.name, passwordHash, tenantId: u.tenantId, roleId: roleIds.get(u.role)! },
    });
  }

  console.log("Seeded DEMO data. Demo users (all share one password):");
  users.forEach((u) => console.log(`  ${u.email}  [${u.role}]`));
  if (generated) console.log(`Generated demo password (shown once): ${password}`);
}

main().finally(() => db.$disconnect());
