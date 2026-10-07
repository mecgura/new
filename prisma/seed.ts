// Seed script. Admin password is NEVER hardcoded — it is read from
// the SEED_ADMIN_PASSWORD environment variable.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { demoWorkflow } from "../src/lib/automations";

const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const adapter = dbUrl.startsWith("postgres")
  ? new PrismaPg({ connectionString: dbUrl })
  : new PrismaBetterSqlite3({ url: dbUrl });
const db = new PrismaClient({ adapter });

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) throw new Error("SEED_ADMIN_EMAIL environment variable is required to seed the admin account.");
  const seedPassword = process.env.SEED_ADMIN_PASSWORD;
  const existingAdmin = await db.user.findUnique({ where: { email: adminEmail } });
  if (seedPassword) {
    // Explicit password provided → (re)set it.
    const passwordHash = await bcrypt.hash(seedPassword, 12);
    await db.user.upsert({
      where: { email: adminEmail },
      update: { passwordHash, role: "SUPER_ADMIN", name: "MECGURA Admin" },
      create: { email: adminEmail, name: "MECGURA Admin", passwordHash, role: "SUPER_ADMIN" },
    });
    console.log(`Seeded admin user: ${adminEmail}`);
  } else if (existingAdmin) {
    // No password provided and admin already exists → keep current password untouched.
    console.log("Kept existing admin password (set SEED_ADMIN_PASSWORD to change it).");
  } else {
    throw new Error("SEED_ADMIN_PASSWORD environment variable is required to seed the admin account.");
  }

  await seedPlans();
  await backfillClientDefaults();
  await seedDemoTenants();
  await backfillClientDefaults();
}

/**
 * Starting plan catalogue. These are only STARTING VALUES stored as data: a plan is created when its slug
 * doesn't exist yet and is never touched again, so everything the admin edits in Billing & Plans (price,
 * limits, features) is preserved. -1 = unlimited. Prices are in paise.
 */
async function seedPlans() {
  const ALL = ["campaigns", "automations", "flows", "ai_agent", "api", "webhooks", "analytics"];
  const plans = [
    { slug: "starter", name: "Starter", description: "For small businesses getting started on WhatsApp", priceMonthly: 199900, maxUsers: 3, maxWhatsAppNumbers: 1, maxMonthlyMessages: 2000, maxContacts: 1000, maxCampaigns: 5, maxAutomations: 3, maxAiReplies: 0, maxApiRequests: 0, features: ["campaigns", "automations", "flows", "analytics"], sortOrder: 1 },
    { slug: "growth", name: "Growth", description: "For growing teams running campaigns", priceMonthly: 499900, maxUsers: 10, maxWhatsAppNumbers: 2, maxMonthlyMessages: 10000, maxContacts: 10000, maxCampaigns: 20, maxAutomations: 10, maxAiReplies: 2000, maxApiRequests: 10000, features: ALL, sortOrder: 2 },
    { slug: "pro", name: "Pro", description: "For high-volume businesses and agencies", priceMonthly: 999900, maxUsers: 25, maxWhatsAppNumbers: 5, maxMonthlyMessages: 50000, maxContacts: 50000, maxCampaigns: 100, maxAutomations: 50, maxAiReplies: 10000, maxApiRequests: 100000, features: ALL, sortOrder: 3 },
    { slug: "enterprise", name: "Enterprise", description: "Custom volumes, numbers and support — arranged with our team", priceMonthly: 2499900, maxUsers: -1, maxWhatsAppNumbers: -1, maxMonthlyMessages: -1, maxContacts: -1, maxCampaigns: -1, maxAutomations: -1, maxAiReplies: -1, maxApiRequests: -1, features: ALL, selfServe: false, sortOrder: 4 },
  ];
  let created = 0;
  for (const p of plans) {
    if (await db.plan.findUnique({ where: { slug: p.slug } })) continue;
    await db.plan.create({ data: { ...p, features: JSON.stringify(p.features) } });
    created++;
  }
  if (created) console.log(`Seeded ${created} plan(s) (edit them in Admin → Billing & Plans)`);
}

/** Every organization gets settings + service rows (idempotent). */
async function backfillClientDefaults() {
  const services = ["WHATSAPP_AUTOMATION", "CRM", "SOCIAL_MEDIA", "ATS", "HRMS", "AI_ASSISTANT"];
  const orgs = await db.organization.findMany({ select: { id: true } });
  for (const { id } of orgs) {
    await db.organizationSettings.upsert({ where: { organizationId: id }, update: {}, create: { organizationId: id } });
    for (const service of services) {
      await db.organizationService.upsert({ where: { organizationId_service: { organizationId: id, service } }, update: {}, create: { organizationId: id, service } });
    }
  }
}

/**
 * Optional LOCAL/QA data: two isolated demo organizations with one user per
 * tenant role. Runs only when SEED_DEMO_PASSWORD is set — never hardcoded.
 */
async function seedDemoTenants() {
  const demoPassword = process.env.SEED_DEMO_PASSWORD;
  if (!demoPassword) return;
  const passwordHash = await bcrypt.hash(demoPassword, 12);
  const tenants = [
    { slug: "demo-org-a", name: "Demo Organization A", users: [["owner.a@demo.mecgura.local", "Owner A", "CLIENT_OWNER"], ["manager.a@demo.mecgura.local", "Manager A", "MANAGER"], ["agent.a@demo.mecgura.local", "Agent A", "AGENT"]] },
    { slug: "demo-org-b", name: "Demo Organization B", users: [["owner.b@demo.mecgura.local", "Owner B", "CLIENT_OWNER"]] },
  ] as const;
  for (const t of tenants) {
    const org = await db.organization.upsert({ where: { slug: t.slug }, update: {}, create: { slug: t.slug, name: t.name } });
    for (const [email, name, role] of t.users) {
      const user = await db.user.upsert({ where: { email }, update: { passwordHash }, create: { email, name, passwordHash, role: "USER" } });
      await db.organizationMember.upsert({
        where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
        update: { role },
        create: { organizationId: org.id, userId: user.id, role },
      });
    }
    const planSlug = t.slug === "demo-org-a" ? "growth" : "starter";
    const plan = await db.plan.findUnique({ where: { slug: planSlug } });
    if (plan && !(await db.subscription.count({ where: { organizationId: org.id, status: "active" } }))) {
      await db.subscription.create({ data: { organizationId: org.id, planId: plan.id, priceMonthly: plan.priceMonthly } });
    }
    // Phase 6 demo workflow (draft — publish it from the builder to switch it on).
    const demoName = "Welcome & route to sales (demo)";
    if (t.slug === "demo-org-a" && !(await db.automation.count({ where: { organizationId: org.id, name: demoName } }))) {
      await db.automation.create({
        data: {
          organizationId: org.id,
          name: demoName,
          description: "New contact → welcome message → short delay → ask requirement → condition → assign sales.",
          graph: JSON.stringify(demoWorkflow()),
        },
      });
    }
    console.log(`Seeded demo tenant: ${t.name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
