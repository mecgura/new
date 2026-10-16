import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import { loadArticle, loadSite, loadSitemapEntries } from "@/lib/website/data";
import { emptyContent, serializeContent } from "@/lib/website/content";
import { domainStatus, getDraft, overview, publishSite, requestDomain, saveSection, unpublishSite } from "./website-content";
import { createItem, getItem, listItems, setItemStatus, updateItem } from "./website-items";
import { getDoctorForEdit, listDoctors, saveDoctorProfile, setDoctorStatus } from "./website-doctors";
import { listEnquiries, setEnquiryStatus, submitEnquiry } from "./enquiries";
import { saveSiteImage } from "./site-images";
import { assertOwnImages } from "./website-shared";
import type { RoleKey } from "@/lib/permissions";

const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
const png = () => sharp({ create: { width: 40, height: 40, channels: 3, background: "#14529e" } }).png().toBuffer().then((b) => new Uint8Array(b));

type T = { id: string; admin: ReturnType<typeof ctxFor>; doctor: ReturnType<typeof ctxFor>; recep: ReturnType<typeof ctxFor>; doctorId: string };
async function mkTenant(label: string): Promise<T> {
  const t = await db.tenant.create({ data: { name: `Site ${label}`, slug: uniq(`site-${label}`).slice(0, 30), status: "ACTIVE" } });
  const mk = async (role: RoleKey) => { const { user } = await makeUser(role, t.id); return { user, ctx: ctxFor(user, role, t.id) }; };
  const [a, d, r] = [await mk("CLINIC_ADMIN"), await mk("DOCTOR"), await mk("RECEPTIONIST")];
  return { id: t.id, admin: a.ctx, doctor: d.ctx, recep: r.ctx, doctorId: d.user.id };
}
const ids = (rows: { slug?: string; title?: string }[]) => rows.map((r) => r.slug);

let A: T, B: T;
beforeAll(async () => {
  await seedSystemData();
  A = await mkTenant("a"); B = await mkTenant("b");
  for (const [t, name] of [[A, "A"], [B, "B"]] as const) {
    await saveSection(asTenant(t.admin), "hero", { headline: `Headline ${name}` });
    await createItem(asTenant(t.admin), "services", { title: `Service ${name}` }).then((s) => setItemStatus(asTenant(t.admin), "services", s.id, "PUBLISHED"));
    await createItem(asTenant(t.admin), "services", { title: `Draft ${name}` });
    await saveDoctorProfile(asTenant(t.admin), t.doctorId, { shortBio: `Doctor ${name}` });
    await setDoctorStatus(asTenant(t.admin), t.doctorId, "PUBLISHED");
    await publishSite(asTenant(t.admin));
  }
});

describe("public website data: Clinic A never shows Clinic B", () => {
  it("each tenant loads only its own published content", async () => {
    const a = await loadSite(A.id, "public"); const b = await loadSite(B.id, "public");
    if (a.kind !== "ok" || b.kind !== "ok") throw new Error("expected sites");
    expect(a.site.content.hero.headline).toBe("Headline A");
    expect(b.site.content.hero.headline).toBe("Headline B");
    expect(a.site.services.map((s) => s.title)).toEqual(["Service A"]);
    expect(b.site.services.map((s) => s.title)).toEqual(["Service B"]);
    expect(a.site.doctors.map((d) => d.shortBio)).toEqual(["Doctor A"]);
    expect(JSON.stringify(a.site)).not.toContain("Headline B");
    expect(JSON.stringify(b.site)).not.toContain("Service A");
  });
  it("public data carries no internal ids", async () => {
    const a = await loadSite(A.id, "public");
    if (a.kind !== "ok") throw new Error();
    const json = JSON.stringify(a.site);
    expect(json).not.toContain(A.id); expect(json).not.toContain(A.doctorId);
    expect(a.site.doctors[0]).not.toHaveProperty("id"); expect(a.site.doctors[0]).not.toHaveProperty("userId");
  });
  it("drafts are never public; preview shows them (own tenant only)", async () => {
    const pub = await loadSite(A.id, "public"); const prev = await loadSite(A.id, "preview");
    if (pub.kind !== "ok" || prev.kind !== "ok") throw new Error();
    expect(pub.site.services.some((s) => s.title === "Draft A")).toBe(false);
    expect(prev.site.services.some((s) => s.title === "Draft A")).toBe(true);
    expect(prev.site.services.some((s) => s.title.endsWith(" B"))).toBe(false);
    expect(prev.site.services.find((s) => s.title === "Draft A")?.isDraft).toBe(true);
  });
  it("sitemap entries are tenant-scoped and published-only", async () => {
    const e = await loadSitemapEntries(A.id);
    expect(e.services.length).toBe(1);
    expect(e.doctors.length).toBe(1);
    expect(e.articles.length).toBe(0);
  });
  it("missing / suspended tenants and unpublished sites", async () => {
    expect((await loadSite("nope", "public")).kind).toBe("missing");
    const C = await mkTenant("c");
    expect((await loadSite(C.id, "public")).kind).toBe("unpublished");
    await db.tenant.update({ where: { id: A.id }, data: { status: "SUSPENDED" } });
    expect((await loadSite(A.id, "public")).kind).toBe("missing");
    await db.tenant.update({ where: { id: A.id }, data: { status: "ACTIVE" } });
  });
});

describe("draft vs published", () => {
  it("saving a draft does not change what visitors see until publish; unpublish takes it offline", async () => {
    await saveSection(asTenant(B.admin), "hero", { headline: "New B headline" });
    const before = await loadSite(B.id, "public");
    if (before.kind !== "ok") throw new Error();
    expect(before.site.content.hero.headline).toBe("Headline B");
    expect((await getDraft(asTenant(B.admin))).hasUnpublishedChanges).toBe(true);
    await publishSite(asTenant(B.admin));
    const after = await loadSite(B.id, "public");
    if (after.kind !== "ok") throw new Error();
    expect(after.site.content.hero.headline).toBe("New B headline");
    await unpublishSite(asTenant(B.admin));
    expect((await loadSite(B.id, "public")).kind).toBe("unpublished");
    await publishSite(asTenant(B.admin));
  });
  it("new items are always DRAFT; publishing needs website.publish", async () => {
    const s = await createItem(asTenant(A.admin), "faq", { question: "Q?", answer: "A." });
    expect((await getItem(asTenant(A.admin), "faq", s.id)).status).toBe("DRAFT");
    expect(await code(setItemStatus(asTenant(A.doctor), "faq", s.id, "PUBLISHED"))).toBe("FORBIDDEN");
    await setItemStatus(asTenant(A.admin), "faq", s.id, "PUBLISHED");
    const pub = await loadSite(A.id, "public"); if (pub.kind !== "ok") throw new Error();
    expect(pub.site.faqs.map((f) => f.question)).toContain("Q?");
  });
  it("validation rejects bad content server-side", async () => {
    expect(await code(saveSection(asTenant(A.admin), "clinic", { whatsapp: "nope" }))).toBe("VALIDATION_ERROR");
    expect(await code(saveSection(asTenant(A.admin), "bogus", {}))).toBe("VALIDATION_ERROR");
    expect(await code(createItem(asTenant(A.admin), "services", { title: "" }))).toBe("VALIDATION_ERROR");
    expect(await code(createItem(asTenant(A.admin), "services", { title: "X", imageUrl: "https://evil.com/a.png" }))).toBe("VALIDATION_ERROR");
    expect(await code(createItem(asTenant(A.admin), "nonsense", { title: "x" }))).toBe("NOT_FOUND");
  });
});

describe("CMS permissions", () => {
  it("receptionist cannot edit, publish or read the CMS (but can handle enquiries)", async () => {
    const r = asTenant(A.recep);
    expect(await code(saveSection(r, "hero", {}))).toBe("FORBIDDEN");
    expect(await code(createItem(r, "services", { title: "x" }))).toBe("FORBIDDEN");
    expect(await code(publishSite(r))).toBe("FORBIDDEN");
    expect(await code(getDraft(r))).toBe("FORBIDDEN");
    expect(await code(listEnquiries(r, {}))).toBe("ok");
  });
  it("doctor: edits only their OWN profile; cannot publish; edit of a live profile reverts it to draft", async () => {
    const d = asTenant(A.doctor);
    expect(await code(saveDoctorProfile(d, A.doctorId, { shortBio: "mine" }))).toBe("ok");
    const { user: other } = await makeUser("DOCTOR", A.id);
    expect(await code(saveDoctorProfile(d, other.id, { shortBio: "not mine" }))).toBe("FORBIDDEN");
    expect(await code(setDoctorStatus(d, A.doctorId, "PUBLISHED"))).toBe("FORBIDDEN");
    expect(await code(saveSection(d, "hero", {}))).toBe("FORBIDDEN");
    expect(await code(createItem(d, "services", { title: "x" }))).toBe("FORBIDDEN");
    expect((await listDoctors(d)).map((x) => x.id)).toEqual([A.doctorId]); // sees only themselves
    const after = await getDoctorForEdit(asTenant(A.admin), A.doctorId);
    expect(after.profile?.status).toBe("DRAFT"); // was PUBLISHED, doctor edited it
    await setDoctorStatus(asTenant(A.admin), A.doctorId, "PUBLISHED");
  });
  it("doctor articles: own drafts only; admin's articles are invisible to them", async () => {
    const d = asTenant(A.doctor);
    const mine = await createItem(d, "articles", { title: "Doctor article", content: "x" });
    const adminOne = await createItem(asTenant(A.admin), "articles", { title: "Admin article" });
    expect(await code(updateItem(d, "articles", mine.id, { title: "Doctor article v2", content: "y" }))).toBe("ok");
    expect(await code(updateItem(d, "articles", adminOne.id, { title: "hijack" }))).toBe("NOT_FOUND");
    expect((await listItems(d, "articles", {})).rows.map((r: { title: string }) => r.title)).toEqual(["Doctor article v2"]);
    expect(await code(setItemStatus(d, "articles", mine.id, "PUBLISHED"))).toBe("FORBIDDEN");
    await setItemStatus(asTenant(A.admin), "articles", mine.id, "PUBLISHED");
    expect((await updateItem(d, "articles", mine.id, { title: "Edited live", content: "z" })).revertedToDraft).toBe(true);
    expect(await loadArticle(A.id, "A", "public", (await getItem(asTenant(A.admin), "articles", mine.id)).slug)).toBeNull();
  });
});

describe("tenant isolation inside the CMS", () => {
  it("Clinic A admin cannot read or change Clinic B items", async () => {
    const bItem = (await listItems(asTenant(B.admin), "services", {})).rows[0];
    for (const res of ["services"] as const) {
      expect(await code(getItem(asTenant(A.admin), res, bItem.id))).toBe("NOT_FOUND");
      expect(await code(updateItem(asTenant(A.admin), res, bItem.id, { title: "hacked" }))).toBe("NOT_FOUND");
      expect(await code(setItemStatus(asTenant(A.admin), res, bItem.id, "ARCHIVED"))).toBe("NOT_FOUND");
    }
    expect((await db.websiteService.findUniqueOrThrow({ where: { id: bItem.id } })).title).not.toBe("hacked");
    expect((await listItems(asTenant(A.admin), "services", {})).rows.every((r: { id: string }) => r.id !== bItem.id)).toBe(true);
    expect(await code(getDoctorForEdit(asTenant(A.admin), B.doctorId))).toBe("NOT_FOUND");
    expect(await code(saveDoctorProfile(asTenant(A.admin), B.doctorId, { shortBio: "x" }))).toBe("NOT_FOUND");
  });
  it("slugs are unique per clinic, not globally", async () => {
    const t = "Same Title";
    const a1 = await createItem(asTenant(A.admin), "services", { title: t }); const a2 = await createItem(asTenant(A.admin), "services", { title: t });
    const b1 = await createItem(asTenant(B.admin), "services", { title: t });
    expect([a1.slug, a2.slug, b1.slug]).toEqual(["same-title", "same-title-2", "same-title"]);
    expect(await code(createItem(asTenant(A.admin), "services", { title: "Other", slug: "same-title" }))).toBe("CONFLICT");
    expect(ids((await listItems(asTenant(B.admin), "services", {})).rows)).not.toContain("same-title-2");
  });
  it("testimonial links must reference this clinic's doctor/service", async () => {
    expect(await code(createItem(asTenant(A.admin), "testimonials", { text: "Great care and friendly staff.", doctorUserId: B.doctorId }))).toBe("VALIDATION_ERROR");
    const bService = (await listItems(asTenant(B.admin), "services", {})).rows[0];
    expect(await code(createItem(asTenant(A.admin), "testimonials", { text: "Great care and friendly staff.", serviceId: bService.id }))).toBe("VALIDATION_ERROR");
    const ok = await createItem(asTenant(A.admin), "testimonials", { text: "Great care and friendly staff.", doctorUserId: A.doctorId });
    expect(ok.id).toBeTruthy();
  });
  it("images: validated, re-encoded, and only your own can be referenced", async () => {
    const { url } = await saveSiteImage(asTenant(A.admin), await png());
    const asset = await db.tenantAsset.findFirstOrThrow({ where: { tenantId: A.id, kind: "SITE_IMAGE" }, orderBy: { createdAt: "desc" } });
    expect(asset.mimeType).toBe("image/webp");
    expect(await code(assertOwnImages(asTenant(A.admin), [url]))).toBe("ok");
    expect(await code(assertOwnImages(asTenant(B.admin), [url]))).toBe("VALIDATION_ERROR"); // another clinic's image id
    expect(await code(createItem(asTenant(B.admin), "services", { title: "Steal image", imageUrl: url, imageAlt: "x" }))).toBe("VALIDATION_ERROR");
    expect(await code(saveSiteImage(asTenant(A.admin), new TextEncoder().encode("<svg onload=alert(1)>")))).toBe("VALIDATION_ERROR");
    expect(await code(saveSiteImage(asTenant(A.recep), await png()))).toBe("FORBIDDEN");
  });
});

describe("contact enquiries", () => {
  const good = { name: "Visitor", phone: "9876543210", message: "I would like to know your timings.", consent: true };
  it("stored under the clinic resolved from the host, visible only to that clinic", async () => {
    await submitEnquiry(A.id, { ...good, name: "Visitor for A" }, "10.0.0.1");
    const a = await listEnquiries(asTenant(A.recep), {}); const b = await listEnquiries(asTenant(B.admin), {});
    expect(a.rows.map((r) => r.name)).toContain("Visitor for A");
    expect(b.rows.map((r) => r.name)).not.toContain("Visitor for A");
    const row = await db.contactEnquiry.findFirstOrThrow({ where: { name: "Visitor for A" } });
    expect(row.tenantId).toBe(A.id); expect(row.ipHash).not.toContain("10.0.0.1");
    expect(await code(setEnquiryStatus(asTenant(B.admin), row.id, "ARCHIVED"))).toBe("NOT_FOUND");
    expect(await code(setEnquiryStatus(asTenant(A.recep), row.id, "READ"))).toBe("ok");
    expect(await code(setEnquiryStatus(asTenant(A.doctor), row.id, "READ"))).toBe("FORBIDDEN");
  });
  it("validation, consent, honeypot and rate limiting", async () => {
    expect(await code(submitEnquiry(A.id, { ...good, consent: false }, "10.0.0.2"))).toBe("VALIDATION_ERROR");
    expect(await code(submitEnquiry(A.id, { name: "V", message: "short" }, "10.0.0.2"))).toBe("VALIDATION_ERROR");
    expect(await code(submitEnquiry(A.id, { name: "Visitor", message: "A long enough message here.", consent: true }, "10.0.0.2"))).toBe("VALIDATION_ERROR"); // needs phone or email
    const before = await db.contactEnquiry.count({ where: { tenantId: A.id } });
    expect(await code(submitEnquiry(A.id, { ...good, website_url: "http://spam.test" }, "10.0.0.3"))).toBe("ok");
    expect(await db.contactEnquiry.count({ where: { tenantId: A.id } })).toBe(before); // bot: nothing stored
    const results: string[] = [];
    for (let i = 0; i < 7; i++) results.push(await code(submitEnquiry(A.id, good, "10.0.0.9")));
    expect(results.filter((r) => r === "RATE_LIMITED").length).toBeGreaterThanOrEqual(2);
  });
  it("an unpublished site (or one with the form off) accepts nothing", async () => {
    const C = await mkTenant("d");
    expect(await code(submitEnquiry(C.id, good, "10.0.0.4"))).toBe("NOT_FOUND");
  });
});

describe("domain + overview", () => {
  it("honest domain states; only a request is stored", async () => {
    expect(domainStatus({ customDomain: null, verified: false, requested: null, published: true })).toBe("NOT_CONNECTED");
    expect(domainStatus({ customDomain: null, verified: false, requested: "x.com", published: true })).toBe("PENDING_VERIFICATION");
    expect(domainStatus({ customDomain: "x.com", verified: false, requested: null, published: true })).toBe("PENDING_VERIFICATION");
    expect(domainStatus({ customDomain: "x.com", verified: true, requested: null, published: false })).toBe("VERIFIED");
    expect(domainStatus({ customDomain: "x.com", verified: true, requested: null, published: true })).toBe("ACTIVE");
    await requestDomain(asTenant(A.admin), { domain: "www.clinic-a-example.com" });
    const t = await db.tenant.findUniqueOrThrow({ where: { id: A.id } });
    expect(t.customDomain).toBeNull(); // not attached — a Super Admin must do that
    expect(await code(requestDomain(asTenant(A.admin), { domain: "https://bad.com/x" }))).toBe("VALIDATION_ERROR");
    expect(await code(requestDomain(asTenant(A.doctor), { domain: "x.example.com" }))).toBe("FORBIDDEN");
  });
  it("overview reports real counts and audit trail has the CMS events", async () => {
    const o = await overview(asTenant(A.admin));
    expect(o.status).toBe("PUBLISHED");
    expect(o.checklist.find((c) => c.key === "services")?.done).toBe(true);
    const actions = (await db.auditLog.findMany({ where: { tenantId: A.id } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["website.content_saved", "website.published", "service.created", "service.status_changed", "doctor_profile.updated", "website.domain_requested", "enquiry.received", "website.image_uploaded"]));
    expect(JSON.stringify(await db.auditLog.findMany({ select: { metadata: true } }))).not.toMatch(/Visitor|9876543210|spam/);
  });
  it("serialiseContent is stable", () => { expect(serializeContent(emptyContent())).toBe(serializeContent(emptyContent())); });
});
