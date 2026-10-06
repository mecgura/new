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

  // Remove permissions that left the catalogue (renamed in Phase 1)
  await db.permission.deleteMany({ where: { key: { notIn: Object.keys(PERMISSIONS) } } });

  // Plans
  const demoPlan = await db.plan.upsert({ where: { key: "demo-all-modules" }, update: { modules: JSON.stringify(MODULE_KEYS) }, create: { key: "demo-all-modules", name: "Demo (all modules)", modules: JSON.stringify(MODULE_KEYS) } });
  await db.plan.upsert({ where: { key: "foundation" }, update: {}, create: { key: "foundation", name: "Foundation", modules: JSON.stringify(["dashboard", "settings", "team"]) } });

  const generated = !process.env.SEED_DEMO_PASSWORD;
  const password = process.env.SEED_DEMO_PASSWORD || `Demo-${randomBytes(6).toString("hex")}1`;
  const passwordHash = await bcrypt.hash(password, 12);
  const all: { email: string; role: string; clinic: string }[] = [];

  // Two independent DEMO clinics (so cross-tenant isolation can be tried by hand)
  const clinics = [
    { slug: "demo-clinic", name: "Demo Clinic", sub: "demo", mail: "demo", primary: undefined as string | undefined, secondary: undefined as string | undefined, accent: undefined as string | undefined },
    { slug: "demo-clinic-b", name: "Demo Clinic B", sub: "demo-b", mail: "demob", primary: "#5b21b6", secondary: "#1d4ed8", accent: "#0f766e" },
  ];
  for (const c of clinics) {
    const tenant = await db.tenant.upsert({
      where: { slug: c.slug }, update: {},
      create: { name: c.name, slug: c.slug, subdomain: c.sub, isDemo: true, status: "ACTIVE", clinicType: "MULTI_DOCTOR", contactEmail: `contact@${c.mail}.mecgura.test` },
    });
    await db.tenantBranding.upsert({ where: { tenantId: tenant.id }, update: {}, create: { tenantId: tenant.id, primaryColor: c.primary, secondaryColor: c.secondary, accentColor: c.accent } });
    await db.subscription.upsert({ where: { tenantId: tenant.id }, update: { planId: demoPlan.id }, create: { tenantId: tenant.id, planId: demoPlan.id, status: "ACTIVE" } });
    const users = [
      { email: `admin@${c.mail}.mecgura.test`, name: `${c.name} Admin`, role: "CLINIC_ADMIN" },
      { email: `doctor@${c.mail}.mecgura.test`, name: `${c.name} Doctor`, role: "DOCTOR" },
      { email: `reception@${c.mail}.mecgura.test`, name: `${c.name} Receptionist`, role: "RECEPTIONIST" },
    ];
    for (const u of users) {
      const user = await db.user.upsert({
        where: { email: u.email },
        update: { passwordHash, status: "ACTIVE", failedLoginCount: 0, lockedUntil: null, deletedAt: null },
        create: { email: u.email, name: u.name, passwordHash, tenantId: tenant.id, roleId: roleIds.get(u.role)! },
      });
      if (u.role === "DOCTOR") await db.doctorProfile.upsert({ where: { userId: user.id }, update: {}, create: { tenantId: tenant.id, userId: user.id, specialization: "General practice (demo)" } });
      else await db.staffProfile.upsert({ where: { userId: user.id }, update: {}, create: { tenantId: tenant.id, userId: user.id } });
      all.push({ email: u.email, role: u.role, clinic: c.name });
    }
  }
  await db.user.upsert({
    where: { email: "platform@demo.mecgura.test" },
    update: { passwordHash, status: "ACTIVE", failedLoginCount: 0, lockedUntil: null, deletedAt: null },
    create: { email: "platform@demo.mecgura.test", name: "Demo Platform Admin", passwordHash, tenantId: null, roleId: roleIds.get("SUPER_ADMIN")! },
  });
  all.push({ email: "platform@demo.mecgura.test", role: "SUPER_ADMIN", clinic: "(platform)" });

  console.log("Seeded DEMO data. Demo users (all share one password):");
  all.forEach((u) => console.log(`  ${u.email}  [${u.role}] ${u.clinic}`));
  if (generated) console.log(`Generated demo password (shown once): ${password}`);
}

main().finally(() => db.$disconnect());
