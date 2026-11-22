import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { siteConfig } from "@/config/site";
import type { OrgAccess } from "@/lib/session";
import { contentToText, parseContent } from "@/lib/onepost";
import { UnsupportedPdfText, pressReleaseDocx, pressReleasePdf } from "@/lib/onepost-docs";
import { assertServiceEnabled } from "@/services/whatsapp/guards";
import { PUBLISHABLE } from "@/services/onepost/state";
import { isPrMailConfigured, sendPrMail } from "@/services/onepost/pr-mail";

const str = (max: number) => z.string().trim().max(max);
const emailField = z.string().trim().toLowerCase().max(160).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email");

export const contactSchema = z.object({ name: z.string().trim().min(2, "Enter a name").max(120), outlet: str(120).default(""), email: emailField, city: str(80).default(""), beat: str(120).default("") });
export const importSchema = z.object({ csv: z.string().min(5).max(200_000) });
export const pitchSchema = z.object({ contactIds: z.array(z.string().min(1).max(64)).min(1, "Choose at least one contact").max(25, "Send to up to 25 contacts at a time") });
export const coverageSchema = z.object({
  coverageUrl: z.string().trim().max(400).refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "Use the full link, starting with https://").default(""),
  coverageNote: str(300).default(""),
});

const DAILY_PITCH_LIMIT = 100;
const log = (a: OrgAccess, action: "onepost.pitch_sent" | "onepost.contact_changed", targetId: string, metadata: Record<string, unknown>, req?: Request) =>
  audit({ action, actorUserId: a.user.id, organizationId: a.organizationId, targetType: "onepost", targetId, metadata, req });

// ---------------------------------------------------------------------------
// Media contacts
// ---------------------------------------------------------------------------

type Row = Awaited<ReturnType<typeof db.onePostContact.findFirstOrThrow>>;
const toDto = (c: Row) => ({ id: c.id, name: c.name, outlet: c.outlet, email: c.email, city: c.city, beat: c.beat, optedOut: c.optedOut, createdAt: c.createdAt });
export type ContactDto = ReturnType<typeof toDto>;

export async function listContacts(a: OrgAccess) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const rows = await db.onePostContact.findMany({ where: { organizationId: a.organizationId }, orderBy: [{ outlet: "asc" }, { name: "asc" }], take: 1000 });
  return { contacts: rows.map(toDto) };
}

export async function createContact(a: OrgAccess, input: z.infer<typeof contactSchema>, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  try {
    const c = await db.onePostContact.create({ data: { organizationId: a.organizationId, optToken: randomBytes(18).toString("base64url"), ...input } });
    await log(a, "onepost.contact_changed", c.id, { action: "added" }, req);
    return toDto(c);
  } catch {
    throw new ApiError("CONFLICT", "That email is already in your media contacts.", { details: { email: ["Already added"] } });
  }
}

export async function updateContact(a: OrgAccess, id: string, input: z.infer<typeof contactSchema>, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const r = await db.onePostContact.updateMany({ where: { id, organizationId: a.organizationId }, data: input }).catch(() => {
    throw new ApiError("CONFLICT", "That email is already in your media contacts.", { details: { email: ["Already added"] } });
  });
  if (!r.count) throw new ApiError("NOT_FOUND", "Contact not found.");
  await log(a, "onepost.contact_changed", id, { action: "edited" }, req);
  return toDto(await db.onePostContact.findFirstOrThrow({ where: { id, organizationId: a.organizationId } }));
}

export async function deleteContact(a: OrgAccess, id: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const r = await db.onePostContact.deleteMany({ where: { id, organizationId: a.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Contact not found.");
  await log(a, "onepost.contact_changed", id, { action: "deleted" }, req);
}

/** Minimal CSV reader: quoted fields, commas inside quotes, doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Imports contacts from CSV text with the columns name, outlet, email, city, beat (header row required). */
export async function importContacts(a: OrgAccess, csv: string, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const rows = parseCsv(csv);
  const head = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  if (!head.includes("email") || !head.includes("name")) throw new ApiError("VALIDATION_ERROR", "The first row must name the columns: name, outlet, email, city, beat.");
  const col = (r: string[], k: string) => (head.includes(k) ? (r[head.indexOf(k)] ?? "").trim() : "");
  if (rows.length > 500) throw new ApiError("VALIDATION_ERROR", "Import up to 500 contacts at a time.");
  let added = 0;
  let updated = 0;
  const skipped: { row: number; reason: string }[] = [];
  for (const [i, r] of rows.entries()) {
    const p = contactSchema.safeParse({ name: col(r, "name"), outlet: col(r, "outlet"), email: col(r, "email"), city: col(r, "city"), beat: col(r, "beat") });
    if (!p.success) {
      skipped.push({ row: i + 2, reason: p.error.issues[0]?.message ?? "Invalid row" });
      continue;
    }
    const existing = await db.onePostContact.findUnique({ where: { organizationId_email: { organizationId: a.organizationId, email: p.data.email } } });
    if (existing) {
      await db.onePostContact.update({ where: { id: existing.id }, data: { name: p.data.name, outlet: p.data.outlet, city: p.data.city, beat: p.data.beat } });
      updated++;
    } else {
      await db.onePostContact.create({ data: { organizationId: a.organizationId, optToken: randomBytes(18).toString("base64url"), ...p.data } });
      added++;
    }
  }
  await log(a, "onepost.contact_changed", "", { action: "imported", added, updated, skipped: skipped.length }, req);
  return { added, updated, skipped };
}

// ---------------------------------------------------------------------------
// Press releases
// ---------------------------------------------------------------------------

export async function listReleases(a: OrgAccess) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const vs = await db.onePostVersion.findMany({ where: { organizationId: a.organizationId, channel: "press_release" }, orderBy: { updatedAt: "desc" }, take: 100 });
  const posts = await db.onePost.findMany({ where: { id: { in: vs.map((v) => v.postId) }, organizationId: a.organizationId }, select: { id: true, title: true, status: true, approvedAt: true, updatedAt: true } });
  const pitches = await db.onePostPitch.findMany({ where: { organizationId: a.organizationId, postId: { in: posts.map((p) => p.id) } }, select: { postId: true, status: true, openedAt: true, coverageUrl: true } });
  return {
    releases: vs.flatMap((v) => {
      const p = posts.find((x) => x.id === v.postId);
      if (!p) return [];
      let headline = p.title;
      try {
        headline = (JSON.parse(v.content) as { headline?: string }).headline || p.title;
      } catch {
        /* keep the title */
      }
      const mine = pitches.filter((x) => x.postId === p.id);
      return [{ postId: p.id, title: p.title, headline, status: p.status, approved: Boolean(p.approvedAt), updatedAt: p.updatedAt, stats: { sent: mine.filter((x) => x.status === "sent").length, opened: mine.filter((x) => x.openedAt).length, covered: mine.filter((x) => x.coverageUrl).length } }];
    }),
    emailReady: isPrMailConfigured(),
  };
}

export async function exportRelease(a: OrgAccess, postId: string, format: "pdf" | "docx") {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const v = await db.onePostVersion.findFirst({ where: { postId, organizationId: a.organizationId, channel: "press_release" } });
  if (!v) throw new ApiError("NOT_FOUND", "This post has no press release yet.");
  const [brand, org, post] = await Promise.all([
    db.onePostBrand.findUnique({ where: { organizationId: a.organizationId }, select: { businessName: true } }),
    db.organization.findUnique({ where: { id: a.organizationId }, select: { name: true } }),
    db.onePost.findFirst({ where: { id: postId, organizationId: a.organizationId }, select: { title: true } }),
  ]);
  const business = brand?.businessName || org?.name || "";
  const pr = parseContent("press_release", JSON.parse(v.content));
  const slug = (post?.title ?? "press-release").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "press-release";
  try {
    if (format === "docx") return { bytes: await pressReleaseDocx(pr, business), type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: `${slug}-press-release.docx` };
    return { bytes: await pressReleasePdf(pr, business), type: "application/pdf", name: `${slug}-press-release.pdf` };
  } catch (e) {
    if (e instanceof UnsupportedPdfText) throw new ApiError("VALIDATION_ERROR", e.message);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Pitch emails
// ---------------------------------------------------------------------------

const firstName = (n: string) => n.trim().split(/\s+/)[0] || "there";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Emails the approved pitch (with the press release below it) to chosen contacts, one email each. Opted-out contacts and repeats are skipped. */
export async function sendPitches(a: OrgAccess, postId: string, input: z.infer<typeof pitchSchema>, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const post = await db.onePost.findFirst({ where: { id: postId, organizationId: a.organizationId } });
  if (!post) throw new ApiError("NOT_FOUND", "Post not found.");
  // Only content a person approved is ever emailed to the press.
  if (!PUBLISHABLE.includes(post.status) || !post.approvedAt) throw new ApiError("CONFLICT", "Only an approved post can be sent to journalists. Approve it first.");
  if (!isPrMailConfigured()) throw new ApiError("SERVICE_UNAVAILABLE", "Email sending isn't set up on this server yet (RESEND_API_KEY and EMAIL_FROM). Ask MECGURA to add it.");
  const [pitchV, prV, brand, org] = await Promise.all([
    db.onePostVersion.findFirst({ where: { postId, organizationId: a.organizationId, channel: "pitch_email" } }),
    db.onePostVersion.findFirst({ where: { postId, organizationId: a.organizationId, channel: "press_release" } }),
    db.onePostBrand.findUnique({ where: { organizationId: a.organizationId } }),
    db.organization.findUnique({ where: { id: a.organizationId }, select: { name: true } }),
  ]);
  if (!pitchV || !prV) throw new ApiError("VALIDATION_ERROR", "Write the press release and the pitch email first.");
  const pitch = parseContent("pitch_email", JSON.parse(pitchV.content));
  const releaseText = contentToText("press_release", JSON.parse(prV.content));
  const business = brand?.businessName || org?.name || "us";

  const contacts = await db.onePostContact.findMany({ where: { organizationId: a.organizationId, id: { in: input.contactIds } } });
  const done = await db.onePostPitch.findMany({ where: { postId, organizationId: a.organizationId, status: "sent" }, select: { contactId: true } });
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const sentToday = await db.onePostPitch.count({ where: { organizationId: a.organizationId, status: "sent", sentAt: { gte: today } } });
  const skipped: { name: string; reason: string }[] = [];
  const todo = contacts.filter((c) => {
    if (c.optedOut) skipped.push({ name: c.name, reason: "Asked not to be contacted." });
    else if (done.some((d) => d.contactId === c.id)) skipped.push({ name: c.name, reason: "Already sent this release." });
    else return true;
    return false;
  });
  if (sentToday + todo.length > DAILY_PITCH_LIMIT) throw new ApiError("RATE_LIMITED", `You can send up to ${DAILY_PITCH_LIMIT} press emails a day. ${Math.max(0, DAILY_PITCH_LIMIT - sentToday)} left today.`);
  for (const id of input.contactIds) if (!contacts.some((c) => c.id === id)) skipped.push({ name: id, reason: "Not in your media contacts." });

  let sent = 0;
  let failed = 0;
  for (const c of todo) {
    const token = randomBytes(18).toString("base64url");
    const row = await db.onePostPitch.create({ data: { organizationId: a.organizationId, postId, contactId: c.id, subject: pitch.subject, trackToken: token, createdById: a.user.id } });
    const unsub = `${siteConfig.url}/api/onepost/unsub/${c.optToken}`;
    const greeting = `Hello ${firstName(c.name)},`;
    const bodyText = /^hello,?\s*\n/i.test(pitch.body) ? pitch.body.replace(/^hello,?\s*\n/i, `${greeting}\n`) : `${greeting}\n\n${pitch.body}`;
    const text = `${bodyText}\n\n---\n\n${releaseText}\n\n---\nYou are receiving this one-off press email from ${business} because you cover news in your area. Do not want these? ${unsub}`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">${esc(bodyText).replace(/\n/g, "<br>")}<hr style="margin:24px 0;border:none;border-top:1px solid #ddd"><div style="white-space:pre-wrap">${esc(releaseText)}</div><p style="margin-top:24px;font-size:12px;color:#666">You are receiving this one-off press email from ${esc(business)} because you cover news in your area. <a href="${unsub}">Do not want these?</a></p><img src="${siteConfig.url}/api/onepost/p/${token}/open" width="1" height="1" alt="" style="display:none"></div>`;
    const r = await sendPrMail({ to: c.email, subject: pitch.subject, text, html, replyTo: brand?.contactEmail || undefined, unsubscribeUrl: unsub });
    await db.onePostPitch.update({ where: { id: row.id }, data: r.ok ? { status: "sent", sentAt: new Date() } : { status: "failed", error: r.error.slice(0, 300) } });
    if (r.ok) sent++;
    else failed++;
  }
  await db.onePostEvent.create({ data: { organizationId: a.organizationId, postId, actorUserId: a.user.id, action: "pitch_sent", note: `${sent} sent, ${failed} failed, ${skipped.length} skipped` } });
  await log(a, "onepost.pitch_sent", postId, { sent, failed, skipped: skipped.length }, req);
  return { sent, failed, skipped };
}

export async function listPitches(a: OrgAccess, postId: string) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const post = await db.onePost.findFirst({ where: { id: postId, organizationId: a.organizationId }, select: { id: true } });
  if (!post) throw new ApiError("NOT_FOUND", "Post not found.");
  const rows = await db.onePostPitch.findMany({ where: { postId, organizationId: a.organizationId }, orderBy: { createdAt: "desc" }, take: 200, include: { contact: { select: { name: true, outlet: true, email: true } } } });
  return { pitches: rows.map((p) => ({ id: p.id, contact: p.contact.name, outlet: p.contact.outlet, email: p.contact.email, status: p.status, error: p.error, sentAt: p.sentAt, openedAt: p.openedAt, openCount: p.openCount, coverageUrl: p.coverageUrl, coverageNote: p.coverageNote })) };
}

export async function setCoverage(a: OrgAccess, pitchId: string, input: z.infer<typeof coverageSchema>, req?: Request) {
  await assertServiceEnabled(a.organizationId, "ONEPOST");
  const r = await db.onePostPitch.updateMany({ where: { id: pitchId, organizationId: a.organizationId }, data: input });
  if (!r.count) throw new ApiError("NOT_FOUND", "Pitch not found.");
  await log(a, "onepost.contact_changed", pitchId, { action: "coverage" }, req);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public: open pixel and unsubscribe (no login)
// ---------------------------------------------------------------------------

export async function recordOpen(token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return;
  const p = await db.onePostPitch.findUnique({ where: { trackToken: token }, select: { id: true, openedAt: true } });
  if (!p) return;
  await db.onePostPitch.update({ where: { id: p.id }, data: { openCount: { increment: 1 }, ...(p.openedAt ? {} : { openedAt: new Date() }) } });
}

export async function contactByOptToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null;
  return db.onePostContact.findUnique({ where: { optToken: token }, select: { id: true, name: true, optedOut: true, organizationId: true } });
}

export async function optOut(token: string) {
  const c = await contactByOptToken(token);
  if (!c) return false;
  await db.onePostContact.update({ where: { id: c.id }, data: { optedOut: true } });
  return true;
}
