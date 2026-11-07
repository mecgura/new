// Seed script. Admin password is NEVER hardcoded — it is read from
// the SEED_ADMIN_PASSWORD environment variable.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { demoWorkflow } from "../src/lib/automations";
import { BLOG_STARTERS } from "./blog-starters";
import { BLOG_STARTERS_HINGLISH } from "./blog-starters-hinglish";

const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const adapter = dbUrl.startsWith("postgres")
  ? new PrismaPg({ connectionString: dbUrl })
  : new PrismaBetterSqlite3({ url: dbUrl });
const db = new PrismaClient({ adapter });

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    console.log("SEED_ADMIN_EMAIL not set — skipping the admin account (plans are still seeded).");
  } else {
    const seedPassword = process.env.SEED_ADMIN_PASSWORD;
    const resetRequested = process.env.SEED_ADMIN_RESET === "true";
    const existingAdmin = await db.user.findUnique({ where: { email: adminEmail } });
    if (!existingAdmin) {
      // First run: create the admin. A password is required.
      if (!seedPassword) throw new Error("SEED_ADMIN_PASSWORD environment variable is required to create the admin account.");
      const passwordHash = await bcrypt.hash(seedPassword, 12);
      await db.user.create({ data: { email: adminEmail, name: "MECGURA Admin", passwordHash, role: "SUPER_ADMIN" } });
      console.log(`Seeded admin user: ${adminEmail}`);
    } else if (resetRequested && seedPassword) {
      // Only an explicit reset (SEED_ADMIN_RESET=true) overwrites a password. A normal redeploy never does,
      // so a password the admin changed in the app survives every deploy.
      const passwordHash = await bcrypt.hash(seedPassword, 12);
      await db.user.update({ where: { email: adminEmail }, data: { passwordHash, role: "SUPER_ADMIN", sessionVersion: { increment: 1 } } });
      console.log(`Reset admin password for ${adminEmail} (SEED_ADMIN_RESET=true).`);
    } else {
      if (existingAdmin.role !== "SUPER_ADMIN") await db.user.update({ where: { email: adminEmail }, data: { role: "SUPER_ADMIN" } });
      console.log("Admin already exists: password left untouched (set SEED_ADMIN_RESET=true with SEED_ADMIN_PASSWORD to reset it).");
    }
  }

  await seedPlans();
  await repriceNov2026();
  await seedBlogStarters();
  await seedBlogStartersHinglish();
  await fixHinglishItalics();
  await backfillClientDefaults();
  await grandfatherAiAssistant();
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
    { slug: "starter", name: "Starter", description: "For small businesses getting started on WhatsApp", priceMonthly: 149900, priceYearly: 1499000, trialDays: 7, maxUsers: 3, maxWhatsAppNumbers: 1, maxMonthlyMessages: 2000, maxContacts: 1000, maxCampaigns: 5, maxAutomations: 3, maxAiReplies: 0, maxApiRequests: 0, features: ["campaigns", "automations", "flows", "analytics"], sortOrder: 1 },
    { slug: "growth", name: "Growth", description: "For growing teams running campaigns", priceMonthly: 349900, priceYearly: 3499000, trialDays: 14, maxUsers: 10, maxWhatsAppNumbers: 2, maxMonthlyMessages: 10000, maxContacts: 10000, maxCampaigns: 20, maxAutomations: 10, maxAiReplies: 2000, maxApiRequests: 10000, features: ALL, sortOrder: 2 },
    { slug: "pro", name: "Pro", description: "For high-volume businesses and agencies", priceMonthly: 749900, priceYearly: 7499000, trialDays: 14, maxUsers: 25, maxWhatsAppNumbers: 5, maxMonthlyMessages: 50000, maxContacts: 50000, maxCampaigns: 100, maxAutomations: 50, maxAiReplies: 10000, maxApiRequests: 100000, features: ALL, sortOrder: 3 },
    { slug: "enterprise", name: "Enterprise", description: "Custom volumes, numbers and support — arranged with our team", priceMonthly: 1999900, maxUsers: -1, maxWhatsAppNumbers: -1, maxMonthlyMessages: -1, maxContacts: -1, maxCampaigns: -1, maxAutomations: -1, maxAiReplies: -1, maxApiRequests: -1, features: ALL, selfServe: false, sortOrder: 4 },
  ];
  let created = 0;
  for (const p of plans) {
    if (await db.plan.findUnique({ where: { slug: p.slug } })) continue;
    await db.plan.create({ data: { ...p, features: JSON.stringify(p.features) } });
    created++;
  }
  if (created) console.log(`Seeded ${created} plan(s) (edit them in Admin → Billing & Plans)`);
}

/**
 * One time (Nov 2026): prices brought in line with the Indian market (AiSensy, Interakt, WATI, Gallabox),
 * yearly billing at 10× monthly (2 months free) and free trials. A plan is only changed while it still has
 * its original seeded price — anything the admin already edited is left alone. Existing clients keep the price
 * they signed up at (subscriptions snapshot it); new prices apply to new sign-ups and plan changes.
 */
async function repriceNov2026() {
  const key = "migration:pricing_2026_11";
  if (await db.siteSetting.findUnique({ where: { key } })) return;
  const changes = [
    { slug: "starter", from: 199900, priceMonthly: 149900, priceYearly: 1499000, trialDays: 7 },
    { slug: "growth", from: 499900, priceMonthly: 349900, priceYearly: 3499000, trialDays: 14 },
    { slug: "pro", from: 999900, priceMonthly: 749900, priceYearly: 7499000, trialDays: 14 },
    { slug: "enterprise", from: 2499900, priceMonthly: 1999900, priceYearly: 0, trialDays: 0 },
  ];
  let changed = 0;
  for (const c of changes) {
    const r = await db.plan.updateMany({ where: { slug: c.slug, priceMonthly: c.from }, data: { priceMonthly: c.priceMonthly, priceYearly: c.priceYearly, trialDays: c.trialDays } });
    changed += r.count;
  }
  await db.siteSetting.create({ data: { key, value: new Date().toISOString() } });
  if (changed) console.log(`Updated prices of ${changed} plan(s) (Nov 2026 pricing).`);
}

/** One time: publish the starter blog articles (skips any slug that already exists; admins can edit or delete them later). */
async function seedBlogStarters() {
  const key = "migration:blog_starters_2026_11";
  if (await db.siteSetting.findUnique({ where: { key } })) return;
  let added = 0;
  for (const s of BLOG_STARTERS) {
    if (await db.blogPost.findUnique({ where: { slug: s.slug } })) continue;
    await db.blogPost.create({ data: { ...s, status: "published", publishedAt: new Date() } });
    added++;
  }
  await db.siteSetting.create({ data: { key, value: new Date().toISOString() } });
  console.log(`Published ${added} starter blog article(s).`);
}

/** One time: the Hinglish starter articles (same rules as the English ones: existing slugs are skipped; admins can edit or delete them). */
async function seedBlogStartersHinglish() {
  const key = "migration:blog_starters_hinglish_2026_11";
  if (await db.siteSetting.findUnique({ where: { key } })) return;
  let added = 0;
  for (const s of BLOG_STARTERS_HINGLISH) {
    if (await db.blogPost.findUnique({ where: { slug: s.slug } })) continue;
    await db.blogPost.create({ data: { ...s, status: "published", publishedAt: new Date() } });
    added++;
  }
  await db.siteSetting.create({ data: { key, value: new Date().toISOString() } });
  console.log(`Published ${added} Hinglish starter blog article(s).`);
}

/** One time: the markdown renderer uses _italic_, so the first Hinglish upload's *italic* shows stars. Fixes only those exact strings. */
async function fixHinglishItalics() {
  const key = "migration:blog_hinglish_italics_2026_11";
  if (await db.siteSetting.findUnique({ where: { key } })) return;
  for (const slug of BLOG_STARTERS_HINGLISH.map((a) => a.slug)) {
    const post = await db.blogPost.findUnique({ where: { slug } });
    if (!post) continue;
    const body = post.body.replaceAll("*Example:*", "_Example:_").replaceAll("*Price list*\n", "_Price list_\n");
    if (body !== post.body) await db.blogPost.update({ where: { slug }, data: { body } });
  }
  await db.siteSetting.create({ data: { key, value: new Date().toISOString() } });
}

/**
 * One time: the AI Agent became a per-client service after workspaces were already using it, and its service rows already
 * exist (switched off). Switch it on once for workspaces running WhatsApp; a marker keeps later deploys from undoing an admin's choice.
 */
async function grandfatherAiAssistant() {
  const key = "migration:ai_assistant_service";
  if (await db.siteSetting.findUnique({ where: { key } })) return;
  const orgs = await db.organizationService.findMany({ where: { service: "WHATSAPP_AUTOMATION", enabled: true }, select: { organizationId: true } });
  for (const { organizationId } of orgs) {
    await db.organizationService.updateMany({ where: { organizationId, service: "AI_ASSISTANT" }, data: { enabled: true } });
  }
  await db.siteSetting.create({ data: { key, value: new Date().toISOString() } });
  console.log(`Switched the AI Assistant service on for ${orgs.length} existing workspace(s).`);
}

/** Every organization gets settings + service rows (idempotent). */
async function backfillClientDefaults() {
  const services = ["WHATSAPP_AUTOMATION", "CRM", "SOCIAL_MEDIA", "AI_ASSISTANT", "OMNICHANNEL", "AI_CALLING", "ADS_MANAGER", "AUTOMATION_PACK", "SMS", "RCS"];
  // Modules added after a workspace was created are switched on once for workspaces that already run WhatsApp, so nobody
  // loses a page they could open before; Super Admin can switch them off per client. Rows that exist are never touched.
  const gated = new Set(["OMNICHANNEL", "AI_CALLING"]);
  const orgs = await db.organization.findMany({ select: { id: true } });
  for (const { id } of orgs) {
    await db.organizationSettings.upsert({ where: { organizationId: id }, update: {}, create: { organizationId: id } });
    const whatsappOn = Boolean((await db.organizationService.findUnique({ where: { organizationId_service: { organizationId: id, service: "WHATSAPP_AUTOMATION" } } }))?.enabled);
    for (const service of services) {
      await db.organizationService.upsert({ where: { organizationId_service: { organizationId: id, service } }, update: {}, create: { organizationId: id, service, enabled: gated.has(service) && whatsappOn } });
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
