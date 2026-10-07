import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime/broker";
import { incrementUsage } from "@/lib/services/usage";
import { assertMonthlyQuota } from "@/services/billing/entitlements";
import { emitContactEvent } from "@/services/webhooks/events";
import { emitAutomationEvent } from "@/services/automations/events";

export type Ctx = { organizationId: string; actorUserId: string | null; req?: Request };

export const LIFECYCLES = ["lead", "customer"] as const;
export const LEAD_STATUSES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
export const CONTACT_SOURCES = ["manual", "whatsapp", "import", "api"] as const;
export const CONTACT_TABS = ["all", "customers", "leads", "opted_in", "opted_out", "suppressed"] as const;
export type ContactTab = (typeof CONTACT_TABS)[number];

/** Normalises user/CSV input to E.164. A bare 10-digit Indian mobile gets +91. Returns null when invalid. */
export function normalizePhone(input: string): string | null {
  let v = input.trim().replace(/[\s()-.]/g, "");
  if (/^[6-9]\d{9}$/.test(v)) v = `+91${v}`;
  else if (/^0[6-9]\d{9}$/.test(v)) v = `+91${v.slice(1)}`;
  else if (/^\d{8,15}$/.test(v)) v = `+${v}`;
  return /^\+[1-9]\d{7,14}$/.test(v) ? v : null;
}

const contactInclude = {
  tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
  owner: { select: { id: true, name: true, email: true } },
  conversations: { orderBy: { lastMessageAt: "desc" as const }, take: 1, select: { id: true, lastMessageAt: true, lastMessagePreview: true, status: true } },
};

type ContactRow = NonNullable<Awaited<ReturnType<typeof loadContact>>>;
function loadContact(organizationId: string, id: string) {
  return db.contact.findFirst({ where: { id, organizationId }, include: contactInclude });
}

function parseCustom(raw: string): Record<string, string> {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function toContactDto(c: ContactRow) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    lifecycle: c.lifecycle,
    leadStatus: c.leadStatus,
    source: c.source,
    owner: c.owner ? { id: c.owner.id, name: c.owner.name ?? c.owner.email } : null,
    optInStatus: c.optInStatus,
    suppressed: c.suppressed,
    suppressionReason: c.suppressionReason,
    customFields: parseCustom(c.customFields),
    tags: c.tags.map((t) => t.tag),
    lastMessageAt: c.lastMessageAt,
    lastConversation: c.conversations[0] ?? null,
    createdAt: c.createdAt,
  };
}
export type ContactDto = ReturnType<typeof toContactDto>;

function tabWhere(tab: ContactTab) {
  switch (tab) {
    case "customers":
      return { lifecycle: "customer" };
    case "leads":
      return { lifecycle: "lead" };
    case "opted_in":
      return { optInStatus: "opted_in" };
    case "opted_out":
      return { optInStatus: "opted_out" };
    case "suppressed":
      return { suppressed: true };
    default:
      return {};
  }
}

export type ContactFilters = { tab: ContactTab; q: string; tagId?: string; leadStatus?: string; ownerUserId?: string };

function filterWhere(organizationId: string, f: ContactFilters) {
  const q = f.q.trim();
  const digits = q.replace(/\D/g, "");
  return {
    organizationId,
    ...tabWhere(f.tab),
    ...(f.tagId ? { tags: { some: { tagId: f.tagId } } } : {}),
    ...(f.leadStatus ? { leadStatus: f.leadStatus } : {}),
    ...(f.ownerUserId ? { ownerUserId: f.ownerUserId } : {}),
    ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] } : {}),
  };
}

export async function listContacts(organizationId: string, f: ContactFilters & { page: number; pageSize: number }) {
  const where = filterWhere(organizationId, f);
  const [rows, total, counts] = await Promise.all([
    db.contact.findMany({ where, orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: contactInclude }),
    db.contact.count({ where }),
    tabCounts(organizationId),
  ]);
  return { items: rows.map(toContactDto), total, counts };
}

async function tabCounts(organizationId: string) {
  const entries = await Promise.all(CONTACT_TABS.map(async (t) => [t, await db.contact.count({ where: { organizationId, ...tabWhere(t) } })] as const));
  return Object.fromEntries(entries) as Record<ContactTab, number>;
}

export async function getContactDetail(organizationId: string, id: string) {
  const c = await loadContact(organizationId, id);
  if (!c) throw new ApiError("NOT_FOUND", "Contact not found.");
  const [notes, consents, conversations] = await Promise.all([
    db.contactNote.findMany({ where: { contactId: id, organizationId }, orderBy: { createdAt: "desc" }, take: 50, include: { author: { select: { name: true, email: true } } } }),
    db.consentRecord.findMany({ where: { contactId: id, organizationId }, orderBy: { createdAt: "desc" }, take: 20, include: { recordedBy: { select: { name: true, email: true } } } }),
    db.conversation.findMany({
      where: { contactId: id, organizationId },
      orderBy: { lastMessageAt: "desc" },
      include: { whatsappAccount: { select: { displayName: true, phoneNumber: true } }, assignedTo: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  return {
    contact: toContactDto(c),
    notes: notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt, author: n.author?.name ?? n.author?.email ?? "System" })),
    consents: consents.map((r) => ({ id: r.id, status: r.status, source: r.source, evidence: r.evidence, createdAt: r.createdAt, recordedBy: r.recordedBy?.name ?? r.recordedBy?.email ?? "System" })),
    conversations: conversations.map((cv) => ({
      id: cv.id,
      status: cv.status,
      lastMessageAt: cv.lastMessageAt,
      lastMessagePreview: cv.lastMessagePreview,
      account: cv.whatsappAccount.displayName,
      accountPhone: cv.whatsappAccount.phoneNumber,
      assignedTo: cv.assignedTo ? cv.assignedTo.name ?? cv.assignedTo.email : null,
    })),
  };
}

/** Monthly new-contact cap from the client's plan (metric: contacts_created). */
async function assertContactQuota(organizationId: string, adding = 1) {
  await assertMonthlyQuota(organizationId, "contacts", adding, "new contacts");
}

async function assertMember(organizationId: string, userId: string | null | undefined) {
  if (!userId) return;
  const m = await db.organizationMember.count({ where: { organizationId, userId } });
  if (!m) throw new ApiError("VALIDATION_ERROR", "Assigned agent must be a member of this workspace.", { details: { ownerUserId: ["Not a team member"] } });
}

export type ContactInput = {
  name?: string;
  phone?: string;
  email?: string;
  lifecycle?: (typeof LIFECYCLES)[number];
  leadStatus?: (typeof LEAD_STATUSES)[number];
  source?: (typeof CONTACT_SOURCES)[number];
  ownerUserId?: string | null;
  customFields?: Record<string, string>;
  suppressed?: boolean;
  suppressionReason?: string;
  tags?: string[];
  optInStatus?: "opted_in" | "opted_out";
  consentEvidence?: string;
};

export async function createContact(ctx: Ctx, input: ContactInput & { phone: string }) {
  const phone = normalizePhone(input.phone);
  if (!phone) throw new ApiError("VALIDATION_ERROR", "Enter a valid phone number.", { details: { phone: ["Use international format, e.g. +919876543210"] } });
  if (await db.contact.findUnique({ where: { organizationId_phone: { organizationId: ctx.organizationId, phone } } })) {
    throw new ApiError("CONFLICT", "A contact with this phone number already exists.", { details: { phone: ["Already exists"] } });
  }
  await assertMember(ctx.organizationId, input.ownerUserId);
  await assertContactQuota(ctx.organizationId);
  const c = await db.contact.create({
    data: {
      organizationId: ctx.organizationId,
      phone,
      name: input.name ?? "",
      email: input.email ?? "",
      lifecycle: input.lifecycle ?? "lead",
      leadStatus: input.leadStatus ?? "new",
      source: input.source ?? "manual",
      ownerUserId: input.ownerUserId ?? null,
      customFields: JSON.stringify(input.customFields ?? {}),
      suppressed: input.suppressed ?? false,
      suppressionReason: input.suppressionReason ?? "",
    },
  });
  await incrementUsage(ctx.organizationId, "contacts_created");
  if (input.tags?.length) await setContactTags(ctx, c.id, input.tags, { silent: true });
  if (input.optInStatus) await recordConsent(ctx, c.id, { status: input.optInStatus, source: input.source === "import" ? "import" : "manual", evidence: input.consentEvidence ?? "" }, { silent: true });
  await audit({ action: "contact.created", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "contact", targetId: c.id, metadata: { source: c.source }, req: ctx.req });
  await emitAutomationEvent(ctx.organizationId, { type: "new_contact", contactId: c.id, source: c.source });
  await emitContactEvent("contact.created", ctx.organizationId, c.id);
  return getContactOrThrow(ctx.organizationId, c.id);
}

async function getContactOrThrow(organizationId: string, id: string) {
  const c = await loadContact(organizationId, id);
  if (!c) throw new ApiError("NOT_FOUND", "Contact not found.");
  return toContactDto(c);
}

export async function updateContact(ctx: Ctx, id: string, input: ContactInput) {
  const before = await db.contact.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!before) throw new ApiError("NOT_FOUND", "Contact not found.");
  let phone: string | undefined;
  if (input.phone !== undefined) {
    const p = normalizePhone(input.phone);
    if (!p) throw new ApiError("VALIDATION_ERROR", "Enter a valid phone number.", { details: { phone: ["Use international format"] } });
    const clash = await db.contact.findUnique({ where: { organizationId_phone: { organizationId: ctx.organizationId, phone: p } } });
    if (clash && clash.id !== id) throw new ApiError("CONFLICT", "Another contact already uses this phone number.", { details: { phone: ["Already exists"] } });
    phone = p;
  }
  if (input.ownerUserId !== undefined) await assertMember(ctx.organizationId, input.ownerUserId);
  await db.contact.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(phone ? { phone } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
      ...(input.leadStatus ? { leadStatus: input.leadStatus } : {}),
      ...(input.source ? { source: input.source } : {}),
      ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.customFields ? { customFields: JSON.stringify(input.customFields) } : {}),
      ...(input.suppressed !== undefined ? { suppressed: input.suppressed, suppressionReason: input.suppressed ? input.suppressionReason ?? before.suppressionReason : "" } : {}),
    },
  });
  if (input.tags) await setContactTags(ctx, id, input.tags, { silent: true });
  if (input.leadStatus && input.leadStatus !== before.leadStatus) {
    await emitAutomationEvent(ctx.organizationId, { type: "lead_status", contactId: id, from: before.leadStatus, to: input.leadStatus });
  }
  if (input.optInStatus && input.optInStatus !== before.optInStatus) {
    await recordConsent(ctx, id, { status: input.optInStatus, source: "manual", evidence: input.consentEvidence ?? "" }, { silent: true });
  }
  const fields = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined);
  await audit({ action: "contact.updated", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "contact", targetId: id, metadata: { fields }, req: ctx.req });
  publish(ctx.organizationId, { type: "contact.updated", contactId: id });
  await emitContactEvent("contact.updated", ctx.organizationId, id, fields);
  return getContactOrThrow(ctx.organizationId, id);
}

export async function deleteContact(ctx: Ctx, id: string) {
  const c = await db.contact.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!c) throw new ApiError("NOT_FOUND", "Contact not found.");
  await db.contact.delete({ where: { id } });
  await audit({ action: "contact.deleted", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "contact", targetId: id, req: ctx.req });
}

export async function setContactTags(ctx: Ctx, contactId: string, names: string[], opts: { silent?: boolean } = {}) {
  const c = await db.contact.findFirst({ where: { id: contactId, organizationId: ctx.organizationId }, select: { id: true } });
  if (!c) throw new ApiError("NOT_FOUND", "Contact not found.");
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 30);
  const previous = new Set((await db.contactTag.findMany({ where: { contactId }, select: { tagId: true } })).map((t) => t.tagId));
  const tags = await Promise.all(
    clean.map((name) =>
      db.tag.upsert({ where: { organizationId_name: { organizationId: ctx.organizationId, name } }, update: {}, create: { organizationId: ctx.organizationId, name } })
    )
  );
  await db.$transaction([
    db.contactTag.deleteMany({ where: { contactId, tagId: { notIn: tags.map((t) => t.id) } } }),
    ...tags.map((t) => db.contactTag.upsert({ where: { contactId_tagId: { contactId, tagId: t.id } }, update: {}, create: { contactId, tagId: t.id } })),
  ]);
  for (const t of tags) if (!previous.has(t.id)) await emitAutomationEvent(ctx.organizationId, { type: "tag_added", contactId, tagName: t.name });
  if (!opts.silent) {
    await audit({ action: "contact.updated", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "contact", targetId: contactId, metadata: { fields: ["tags"] }, req: ctx.req });
    publish(ctx.organizationId, { type: "contact.updated", contactId });
  }
  return tags.map((t) => ({ id: t.id, name: t.name, color: t.color }));
}

export async function addContactNote(ctx: Ctx, contactId: string, body: string) {
  const c = await db.contact.findFirst({ where: { id: contactId, organizationId: ctx.organizationId }, select: { id: true } });
  if (!c) throw new ApiError("NOT_FOUND", "Contact not found.");
  const note = await db.contactNote.create({ data: { organizationId: ctx.organizationId, contactId, authorUserId: ctx.actorUserId, body } });
  publish(ctx.organizationId, { type: "contact.updated", contactId });
  return note;
}

/** Consent is append-only: every change writes a ConsentRecord; Contact.optInStatus mirrors the latest. */
export async function recordConsent(
  ctx: Ctx,
  contactId: string,
  input: { status: "opted_in" | "opted_out"; source: "manual" | "import" | "inbound_keyword" | "api" | "flow" | "ai"; evidence: string },
  opts: { silent?: boolean } = {}
) {
  const c = await db.contact.findFirst({ where: { id: contactId, organizationId: ctx.organizationId }, select: { id: true, optInStatus: true } });
  if (!c) throw new ApiError("NOT_FOUND", "Contact not found.");
  await db.$transaction([
    db.consentRecord.create({ data: { organizationId: ctx.organizationId, contactId, status: input.status, source: input.source, evidence: input.evidence.slice(0, 500), recordedById: ctx.actorUserId } }),
    db.contact.update({ where: { id: contactId }, data: { optInStatus: input.status } }),
  ]);
  if (!opts.silent || c.optInStatus !== input.status) {
    await audit({ action: "contact.consent_changed", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "contact", targetId: contactId, metadata: { from: c.optInStatus, to: input.status, source: input.source }, req: ctx.req });
  }
  publish(ctx.organizationId, { type: "contact.updated", contactId });
}

/** Inbound WhatsApp sender → contact (created on first message). */
export async function upsertInboundContact(organizationId: string, phone: string, profileName: string) {
  const existing = await db.contact.findUnique({ where: { organizationId_phone: { organizationId, phone } } });
  const now = new Date();
  if (existing) {
    return db.contact.update({ where: { id: existing.id }, data: { lastInboundAt: now, lastMessageAt: now, ...(!existing.name && profileName ? { name: profileName } : {}) } });
  }
  const c = await db.contact.create({ data: { organizationId, phone, name: profileName, source: "whatsapp", lastInboundAt: now, lastMessageAt: now } });
  await incrementUsage(organizationId, "contacts_created");
  await audit({ action: "contact.created", organizationId, targetType: "contact", targetId: c.id, metadata: { source: "whatsapp" } });
  await emitAutomationEvent(organizationId, { type: "new_contact", contactId: c.id, source: "whatsapp" });
  await emitContactEvent("contact.created", organizationId, c.id);
  return c;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true; // quotes only open a field at its start
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Neutralises spreadsheet formula injection (=, +, -, @, tab, CR) and quotes the cell. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADER_ALIASES: Record<string, string> = {
  name: "name",
  full_name: "name",
  phone: "phone",
  mobile: "phone",
  whatsapp: "phone",
  email: "email",
  tags: "tags",
  lead_status: "leadStatus",
  status: "leadStatus",
  lifecycle: "lifecycle",
  type: "lifecycle",
  source: "source",
  opt_in: "optIn",
  consent: "optIn",
};

export const MAX_IMPORT_ROWS = 5000;

export async function importContactsCsv(ctx: Ctx, text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new ApiError("VALIDATION_ERROR", "The CSV needs a header row and at least one contact.");
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new ApiError("VALIDATION_ERROR", `Import up to ${MAX_IMPORT_ROWS} contacts at a time.`);
  const header = rows[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/[\s-]+/g, "_")] ?? "");
  if (!header.includes("phone")) throw new ApiError("VALIDATION_ERROR", "The CSV must have a “phone” column.");

  const parsed: { line: number; data: Record<string, string> }[] = rows.slice(1).map((r, i) => ({
    line: i + 2,
    data: Object.fromEntries(header.map((h, j) => [h, (r[j] ?? "").trim()]).filter(([h]) => h)),
  }));
  const newPhones = new Set<string>();
  for (const p of parsed) {
    const phone = normalizePhone(p.data.phone ?? "");
    if (phone && !(await db.contact.findUnique({ where: { organizationId_phone: { organizationId: ctx.organizationId, phone } }, select: { id: true } }))) newPhones.add(phone);
  }
  await assertContactQuota(ctx.organizationId, newPhones.size);

  const result = { created: 0, updated: 0, skipped: 0, errors: [] as { line: number; error: string }[] };
  const seen = new Set<string>();
  for (const { line, data } of parsed) {
    const phone = normalizePhone(data.phone ?? "");
    if (!phone) {
      result.skipped++;
      result.errors.push({ line, error: "Invalid phone number" });
      continue;
    }
    if (seen.has(phone)) {
      result.skipped++;
      result.errors.push({ line, error: "Duplicate phone in file" });
      continue;
    }
    seen.add(phone);
    const leadStatus = (LEAD_STATUSES as readonly string[]).includes(data.leadStatus?.toLowerCase()) ? (data.leadStatus.toLowerCase() as ContactInput["leadStatus"]) : undefined;
    const lifecycle = (LIFECYCLES as readonly string[]).includes(data.lifecycle?.toLowerCase()) ? (data.lifecycle.toLowerCase() as ContactInput["lifecycle"]) : undefined;
    const optIn = /^(yes|y|true|1|opted_in|opt-in)$/i.test(data.optIn ?? "") ? "opted_in" : /^(no|n|false|0|opted_out|opt-out)$/i.test(data.optIn ?? "") ? "opted_out" : undefined;
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email ?? "") ? data.email.toLowerCase() : "";
    const tags = (data.tags ?? "").split(/[;|]/).map((t) => t.trim()).filter(Boolean);
    const existing = await db.contact.findUnique({ where: { organizationId_phone: { organizationId: ctx.organizationId, phone } } });
    const silentCtx = { ...ctx, req: undefined };
    if (existing) {
      await db.contact.update({
        where: { id: existing.id },
        data: { ...(data.name ? { name: data.name.slice(0, 120) } : {}), ...(email ? { email } : {}), ...(leadStatus ? { leadStatus } : {}), ...(lifecycle ? { lifecycle } : {}) },
      });
      if (tags.length) {
        const current = await db.contactTag.findMany({ where: { contactId: existing.id }, include: { tag: true } });
        await setContactTags(silentCtx, existing.id, [...current.map((t) => t.tag.name), ...tags], { silent: true });
      }
      if (optIn && optIn !== existing.optInStatus) await recordConsent(silentCtx, existing.id, { status: optIn, source: "import", evidence: `CSV line ${line}` }, { silent: true });
      result.updated++;
      await emitContactEvent("contact.updated", ctx.organizationId, existing.id, ["import"]);
    } else {
      const c = await db.contact.create({
        data: { organizationId: ctx.organizationId, phone, name: (data.name ?? "").slice(0, 120), email, source: "import", ...(leadStatus ? { leadStatus } : {}), ...(lifecycle ? { lifecycle } : {}) },
      });
      await incrementUsage(ctx.organizationId, "contacts_created");
      if (tags.length) await setContactTags(silentCtx, c.id, tags, { silent: true });
      if (optIn) await recordConsent(silentCtx, c.id, { status: optIn, source: "import", evidence: `CSV line ${line}` }, { silent: true });
      result.created++;
      await emitContactEvent("contact.created", ctx.organizationId, c.id);
    }
  }
  await audit({ action: "contacts.imported", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "contact", metadata: { created: result.created, updated: result.updated, skipped: result.skipped }, req: ctx.req });
  return { ...result, errors: result.errors.slice(0, 100) };
}

export async function exportContactsCsv(ctx: Ctx, f: ContactFilters): Promise<{ csv: string; count: number }> {
  const rows = await db.contact.findMany({ where: filterWhere(ctx.organizationId, f), orderBy: { createdAt: "asc" }, include: contactInclude, take: 50_000 });
  const header = ["name", "phone", "email", "lifecycle", "lead_status", "source", "tags", "opt_in", "suppressed", "assigned_agent", "last_message_at", "created_at"];
  const lines = [header.join(",")];
  for (const r of rows.map(toContactDto)) {
    lines.push(
      [r.name, r.phone, r.email, r.lifecycle, r.leadStatus, r.source, r.tags.map((t) => t.name).join(";"), r.optInStatus, r.suppressed ? "yes" : "no", r.owner?.name ?? "", r.lastMessageAt?.toISOString() ?? "", r.createdAt.toISOString()]
        .map(csvCell)
        .join(",")
    );
  }
  await audit({ action: "contacts.exported", actorUserId: ctx.actorUserId, organizationId: ctx.organizationId, targetType: "contact", metadata: { count: rows.length, tab: f.tab }, req: ctx.req });
  return { csv: `${lines.join("\r\n")}\r\n`, count: rows.length };
}
