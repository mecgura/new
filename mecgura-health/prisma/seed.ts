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
import { addDays, todayIn, zonedToUtc } from "../src/lib/scheduling/time";
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

/** Demo scheduling: availability, a few DEMO patients, appointments and a small live queue. Idempotent. */
async function seedScheduling(tenantId: string, key: "A" | "B") {
  const doctor = await db.user.findFirst({ where: { tenantId, role: { key: "DOCTOR" } } });
  if (!doctor) return;
  const tz = "Asia/Kolkata";
  const today = todayIn(tz);
  await db.notification.deleteMany({ where: { tenantId } });
  await db.investigationOrder.deleteMany({ where: { tenantId } }); // cascades items, samples + custody events, results, reports, versions, reviews
  await db.investigation.deleteMany({ where: { tenantId } }); // cascades parameters
  await db.labConfigItem.deleteMany({ where: { tenantId } });
  await db.labPartner.deleteMany({ where: { tenantId } });
  await db.consultation.deleteMany({ where: { tenantId } }); // cascades vitals, diagnoses, prescriptions, versions, orders
  await db.consultationTemplate.deleteMany({ where: { tenantId } });
  await db.medicineReference.deleteMany({ where: { tenantId } });
  await db.opdVisit.deleteMany({ where: { tenantId } });
  await db.appointment.deleteMany({ where: { tenantId } });
  await db.blockedTime.deleteMany({ where: { tenantId } });
  await db.availabilityWindow.deleteMany({ where: { tenantId } });
  await db.tenantCounter.deleteMany({ where: { tenantId } });
  await db.patient.deleteMany({ where: { tenantId } });
  await db.familyGroup.deleteMany({ where: { tenantId } });

  await db.doctorSchedule.upsert({
    where: { doctorUserId: doctor.id },
    update: { slotMinutes: 15, onlineBooking: true, roomLabel: key === "A" ? "Consultation Room 1" : "Room B1" },
    create: { tenantId, doctorUserId: doctor.id, slotMinutes: 15, bufferMinutes: 0, onlineBooking: true, advanceDays: 30, minNoticeMinutes: 30, roomLabel: key === "A" ? "Consultation Room 1" : "Room B1" },
  });
  const day = (weekday: number, a: number, b: number) => ({ tenantId, doctorUserId: doctor.id, weekday, startMinutes: a, endMinutes: b });
  await db.availabilityWindow.createMany({ data: [1, 2, 3, 4, 5].flatMap((w) => [day(w, 10 * 60, 13 * 60), day(w, 14 * 60, 17 * 60)]).concat([day(6, 10 * 60, 13 * 60)]) });
  await db.opdSettings.upsert({ where: { tenantId }, update: {}, create: { tenantId, tokenFormat: key === "A" ? "NUMERIC" : "PREFIXED", tokenPad: 2, prefixes: "{}", displayKey: `demo-display-${key.toLowerCase()}-${randomBytes(6).toString("hex")}` } });

  const names = ["Demo Patient One", "Demo Patient Two", "Demo Patient Three"];
  const patients: { id: string }[] = [];
  for (const [i, name] of names.entries()) patients.push(await db.patient.create({ data: { tenantId, code: `P-${String(i + 1).padStart(6, "0")}`, name, phone: `+9190000000${i + 1}0`, gender: i === 1 ? "FEMALE" : "MALE", ageYears: 30 + i * 12 } }));
  await db.tenantCounter.create({ data: { tenantId, key: "patient", value: patients.length } });
  // synthetic CRM data (clearly demo; nothing here is real or medical advice)
  await db.patient.update({ where: { id: patients[0].id }, data: { dateOfBirth: new Date("1988-04-12T00:00:00Z"), ageYears: null, addressLine: "1 Sample Road (demo)", city: "Demo City", state: "Demo State", country: "India", pincode: "000000", bloodGroup: "B+", emergencyContactName: "Demo Relative", emergencyContactRelation: "Sibling", emergencyContactPhone: "+919000000999", prefWhatsapp: "ALLOWED", prefSms: "NOT_ALLOWED" } });
  await db.patientConsent.create({ data: { tenantId, patientId: patients[0].id, type: "PRIVACY", status: "GRANTED", version: "clinic-notice-v1" } });
  await db.patientAllergy.create({ data: { tenantId, patientId: patients[0].id, allergen: "Demo allergen (sample)", reaction: "Rash (sample)", severity: "MODERATE" } });
  await db.patientHistory.create({ data: { tenantId, patientId: patients[0].id, category: "SURGERY", title: "Demo procedure (sample entry)", occurredOn: "2018", status: "RESOLVED" } });
  await db.patientMedication.create({ data: { tenantId, patientId: patients[0].id, name: "Demo medicine (sample)", strength: "10 mg", frequency: "once daily" } });
  await db.patientNote.create({ data: { tenantId, patientId: patients[0].id, kind: "RECEPTION", content: "Demo note: prefers morning appointments.", authorId: doctor.id, authorRole: "DOCTOR" } });
  const fam = await db.familyGroup.create({ data: { tenantId } });
  await db.patient.updateMany({ where: { id: { in: [patients[0].id, patients[1].id] } }, data: { familyGroupId: fam.id } });

  const at = (date: string, hh: number, mm: number) => zonedToUtc(date, hh * 60 + mm, tz);
  const appt = async (date: string, hh: number, mm: number, over: Record<string, unknown>) => {
    const startsAt = at(date, hh, mm);
    return db.appointment.create({ data: { tenantId, doctorUserId: doctor.id, startsAt, endsAt: new Date(startsAt.getTime() + 15 * 60000), type: "OPD", source: "RECEPTION", status: "CONFIRMED", slotLock: `${doctor.id}|${startsAt.toISOString()}`, publicId: `AP-DEMO${randomBytes(3).toString("hex").toUpperCase()}`, ...over } });
  };
  const tomorrow = addDays(today, 1);
  await appt(tomorrow, 10, 0, { patientId: patients[0].id });
  await appt(tomorrow, 10, 15, { contactName: "Demo Online Visitor", contactPhone: "+919000000099", type: "ONLINE_APPOINTMENT", source: "WEBSITE", status: "REQUESTED", reason: "Demo booking request" });
  await appt(today, 16, 0, { patientId: patients[2].id }); // a confirmed appointment today, ready for check-in
  const visit = async (n: number, p: number, status: string, extra: Record<string, unknown> = {}) =>
    db.opdVisit.create({ data: { tenantId, patientId: patients[p].id, doctorUserId: doctor.id, visitType: "WALK_IN", queueType: "WALK_IN", priority: "NORMAL", status, tokenDate: today, tokenPrefix: "", tokenNumber: n, tokenLabel: String(n).padStart(2, "0"), publicToken: `demo${key}${n}${randomBytes(5).toString("hex")}`, queueSeq: n, ...extra } });
  await visit(1, 0, "COMPLETED", { startedAt: new Date(Date.now() - 40 * 60000), completedAt: new Date(Date.now() - 25 * 60000) });
  await visit(2, 1, "WAITING");
  await db.tenantCounter.createMany({ data: [{ tenantId, key: `token:${today}:`, value: 2 }, { tenantId, key: `queue:${today}`, value: 2 }] });
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
    const users: { email: string; name: string; role: string; grants?: string[] }[] = [
      { email: `admin@${c.mail}.mecgura.test`, name: `${c.name} Admin`, role: "CLINIC_ADMIN" },
      { email: `doctor@${c.mail}.mecgura.test`, name: `${c.name} Doctor`, role: "DOCTOR" },
      { email: `reception@${c.mail}.mecgura.test`, name: `${c.name} Receptionist`, role: "RECEPTIONIST" },
      { email: `lab@${c.mail}.mecgura.test`, name: `${c.name} Lab Technician`, role: "LAB_STAFF" },
      { email: `labreviewer@${c.mail}.mecgura.test`, name: `${c.name} Lab Reviewer`, role: "LAB_STAFF", grants: ["lab.review"] },
    ];
    for (const u of users) {
      const user = await db.user.upsert({
        where: { email: u.email },
        update: { passwordHash, status: "ACTIVE", failedLoginCount: 0, lockedUntil: null, deletedAt: null },
        create: { email: u.email, name: u.name, passwordHash, tenantId: tenant.id, roleId: roleIds.get(u.role)! },
      });
      if (u.role === "DOCTOR") await db.doctorProfile.upsert({ where: { userId: user.id }, update: {}, create: { tenantId: tenant.id, userId: user.id, specialization: "General practice (demo)" } });
      else await db.staffProfile.upsert({ where: { userId: user.id }, update: {}, create: { tenantId: tenant.id, userId: user.id } });
      // a lab reviewer is an ordinary lab technician who was granted verification/release rights
      for (const permission of u.grants ?? []) await db.userPermissionGrant.upsert({ where: { userId_permission: { userId: user.id, permission } }, update: {}, create: { tenantId: tenant.id, userId: user.id, permission } });
      all.push({ email: u.email, role: u.role, clinic: c.name });
    }
    await seedWebsite(tenant.id, c.slug === "demo-clinic"
      ? { key: "A", name: c.name, colour: "#0e7c86", hours: { monday: ["09:00", "17:00"], tuesday: ["09:00", "17:00"], wednesday: ["09:00", "17:00"], thursday: ["09:00", "17:00"], friday: ["09:00", "17:00"], saturday: ["09:00", "13:00"], sunday: null }, whatsapp: "911234567890", services: ["General Consultation (demo)", "Follow-up Consultation (demo)", "Health Check-up (demo)"], faq: [["How do I book an appointment? (demo)", "Demo answer: contact the clinic."], ["What should I bring? (demo)", "Demo answer."]] }
      : { key: "B", name: c.name, colour: "#5b21b6", hours: { monday: ["10:00", "19:00"], tuesday: ["10:00", "19:00"], wednesday: ["10:00", "19:00"], thursday: ["10:00", "19:00"], friday: ["10:00", "19:00"], saturday: ["10:00", "19:00"], sunday: null }, services: ["Specialist Consultation (demo)", "Second Opinion (demo)"], faq: [["Do you take walk-ins? (demo)", "Demo answer for clinic B."]] });
    await seedScheduling(tenant.id, c.slug === "demo-clinic" ? "A" : "B");
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
