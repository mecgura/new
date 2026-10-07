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
import sharp from "sharp";
import { siteContentSchema } from "../src/lib/website/content";
import { PERMISSIONS, ROLES, ROLE_LABELS, ROLE_PERMISSIONS } from "../src/lib/permissions";

if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const url = process.env.DATABASE_URL ?? "file:./dev.db";
const db = new PrismaClient({ adapter: url.startsWith("postgres") ? new PrismaPg({ connectionString: url }) : new PrismaBetterSqlite3({ url }) });

/** Demo website content. EVERYTHING here is sample text, labelled "demo" — never real doctors, services or reviews. */
async function seedWebsite(tenantId: string, spec: { key: "A" | "B"; name: string; colour: string; hours: Record<string, [string, string] | null>; whatsapp?: string; services: string[]; faq: [string, string][] }) {
  const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="48" fill="${spec.colour}"/><text x="128" y="170" font-family="Arial" font-size="140" font-weight="700" text-anchor="middle" fill="#fff">${spec.key}</text></svg>`;
  const png = await sharp(Buffer.from(logoSvg)).png().toBuffer();
  const logo = await db.tenantAsset.upsert({ where: { tenantId_kind_ownerId: { tenantId, kind: "LOGO", ownerId: "" } }, update: { data: png, size: png.length }, create: { tenantId, kind: "LOGO", ownerId: "", mimeType: "image/png", size: png.length, data: png } });
  await db.tenantBranding.update({ where: { tenantId }, data: { logoUrl: `/api/assets/${logo.id}?v=1` } });
  await db.tenant.update({ where: { id: tenantId }, data: { address: `1 Sample Road (demo address)`, city: spec.key === "A" ? "Demo City A" : "Demo City B", state: "Demo State", pincode: "000000", websiteEnabled: true } });

  const hours = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => {
    const h = spec.hours[d];
    return [d, h ? { open: true, from: h[0], to: h[1], breaks: d === "saturday" || spec.key === "B" ? [] : [{ from: "13:00", to: "14:00" }] } : { open: false }];
  }));
  const content = siteContentSchema.parse({
    hero: { headline: `${spec.name} (demo website)`, subheadline: "Sample content — not a real clinic", intro: "This is demo content created for development and testing. Replace it with your own information.", primaryCtaLabel: "Book appointment" },
    about: { title: `About ${spec.name}`, body: "## About (demo)\n\nDemo text only. A real clinic describes its practice here in its own words.", philosophy: "Demo philosophy text." },
    clinic: { description: "Demo clinic description. **No real facilities are claimed.**", facilities: ["Demo facility (sample)"], parking: "Demo parking note.", whatsapp: spec.whatsapp ?? "", hours },
    contact: { intro: "Demo contact page. Messages sent from a demo site are stored in the demo database only." },
    legal: { privacy: "## Privacy policy (demo)\n\nDemo text — not a real policy.", terms: "" },
    footer: { description: "Demo website — sample content." },
    seo: { defaultDescription: `Demo website for ${spec.name}.`, indexable: spec.key === "A" },
  });
  const json = JSON.stringify(content);
  await db.website.upsert({ where: { tenantId }, update: { draftContent: json, publishedContent: json, status: "PUBLISHED", publishedAt: new Date() }, create: { tenantId, draftContent: json, publishedContent: json, status: "PUBLISHED", publishedAt: new Date() } });

  await db.websiteService.deleteMany({ where: { tenantId } });
  for (const [i, title] of spec.services.entries()) {
    await db.websiteService.create({ data: { tenantId, title, slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), shortDescription: "Demo service description.", description: "## Demo\n\nSample service text. No medical claims are made.", durationMinutes: 20 + i * 10, fee: 500 + i * 250, showFee: i === 0, icon: ["stethoscope", "heart-pulse", "clipboard-list"][i % 3], sortOrder: i, status: "PUBLISHED", publishedAt: new Date() } });
  }
  await db.websiteService.create({ data: { tenantId, title: `${spec.key} Draft service (demo)`, slug: `${spec.key.toLowerCase()}-draft-service`, shortDescription: "This draft must never be public.", status: "DRAFT" } });

  await db.faqItem.deleteMany({ where: { tenantId } });
  for (const [i, [q, a]] of spec.faq.entries()) await db.faqItem.create({ data: { tenantId, question: q, answer: a, sortOrder: i, status: "PUBLISHED", publishedAt: new Date() } });
  await db.testimonial.deleteMany({ where: { tenantId } });
  await db.testimonial.create({ data: { tenantId, text: "Demo testimonial — sample text only, not a real patient's words.", displayName: null, rating: 5, status: "PUBLISHED", publishedAt: new Date() } });
  await db.article.deleteMany({ where: { tenantId } });
  await db.article.create({ data: { tenantId, slug: `${spec.key.toLowerCase()}-demo-article`, title: `Demo article ${spec.key}`, excerpt: "Sample article for testing.", content: "## Demo article\n\nGeneral demo text. **Not medical advice.**\n\n- Item one\n- Item two", category: "Demo", tags: JSON.stringify(["demo"]), status: "PUBLISHED", publishedAt: new Date("2026-01-01T00:00:00Z") } });
  await db.article.create({ data: { tenantId, slug: `${spec.key.toLowerCase()}-draft-article`, title: `${spec.key} Draft article (demo)`, content: "Draft — must never be public.", status: "DRAFT" } });

  const doctor = await db.user.findFirst({ where: { tenantId, role: { key: "DOCTOR" } } });
  if (doctor) {
    await db.doctorProfile.update({ where: { userId: doctor.id }, data: { qualification: "Demo qualification (sample)", specialization: spec.key === "A" ? "General practice (demo)" : "Specialist consultation (demo)", experienceYears: 8, registrationNumber: "DEMO-0000", consultationFee: 500 } });
    await db.doctorPublicProfile.upsert({ where: { userId: doctor.id }, update: { status: "PUBLISHED" }, create: { tenantId, userId: doctor.id, slug: `demo-doctor-${spec.key.toLowerCase()}`, shortBio: "Demo biography. Replace with the doctor's own words.", bio: "## Demo doctor\n\nSample profile text.", education: "Demo education (sample).", certifications: JSON.stringify(["Demo certification"]), languages: JSON.stringify(["English"]), showRegistration: false, status: "PUBLISHED", publishedAt: new Date() } });
  }
}

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
    await seedWebsite(tenant.id, c.slug === "demo-clinic"
      ? { key: "A", name: c.name, colour: "#0e7c86", hours: { monday: ["09:00", "17:00"], tuesday: ["09:00", "17:00"], wednesday: ["09:00", "17:00"], thursday: ["09:00", "17:00"], friday: ["09:00", "17:00"], saturday: ["09:00", "13:00"], sunday: null }, whatsapp: "911234567890", services: ["General Consultation (demo)", "Follow-up Consultation (demo)", "Health Check-up (demo)"], faq: [["How do I book an appointment? (demo)", "Demo answer: contact the clinic."], ["What should I bring? (demo)", "Demo answer."]] }
      : { key: "B", name: c.name, colour: "#5b21b6", hours: { monday: ["10:00", "19:00"], tuesday: ["10:00", "19:00"], wednesday: ["10:00", "19:00"], thursday: ["10:00", "19:00"], friday: ["10:00", "19:00"], saturday: ["10:00", "19:00"], sunday: null }, services: ["Specialist Consultation (demo)", "Second Opinion (demo)"], faq: [["Do you take walk-ins? (demo)", "Demo answer for clinic B."]] });
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
