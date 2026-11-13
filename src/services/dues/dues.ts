import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import type { OrgAccess } from "@/lib/session";
import { templateSlots, paramProblem, type SlotValues } from "@/lib/templates";
import { normalizePhone, recordConsent } from "@/services/inbox/contacts";
import { SystemSendError, sendTemplateToContact } from "@/services/inbox/messaging";
import { requireApprovedTemplate, toDef } from "@/services/templates/templates";

/**
 * Payment reminders from an accounts export. The client exports unpaid bills from Tally / Busy / Excel as CSV,
 * uploads it here, and each customer gets a WhatsApp reminder through an approved template.
 */
const MAX_ROWS = 2000;
const HEADERS = {
  name: /^(name|party|party name|customer|customer name|ledger|account)$/i,
  phone: /^(phone|mobile|mobile no\.?|mobile number|phone number|contact|contact no\.?|whatsapp)$/i,
  amount: /^(amount|balance|pending|pending amount|outstanding|due|due amount|closing balance|bill amount)$/i,
  invoice: /^(invoice|invoice no\.?|bill|bill no\.?|voucher|voucher no\.?|ref|ref no\.?|reference)$/i,
  due: /^(due date|due on|date|bill date|invoice date)$/i,
};

/** Splits one CSV line, honouring "quoted, values". */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === "\t" || ch === ";") (out.push(cur), (cur = ""));
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseDate(v: string): Date | null {
  const m = v.match(/^(\d{1,2})[-/.](\d{1,2}|[A-Za-z]{3})[-/.](\d{2,4})$/);
  if (m) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = /^\d+$/.test(m[2]) ? Number(m[2]) - 1 : months.indexOf(m[2].toLowerCase());
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(year, month, Number(m[1])));
    return month >= 0 && !Number.isNaN(d.getTime()) ? d : null;
  }
  const iso = /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(v) : null;
  return iso && !Number.isNaN(iso.getTime()) ? iso : null;
}

export type DueRow = { name: string; phone: string; invoiceNo: string; amountPaise: number; dueDate: Date | null };

/** Reads the CSV. Column names are matched loosely, so a raw Tally / Excel export usually works as it is. */
export function parseDuesCsv(text: string): { rows: DueRow[]; skipped: { line: number; reason: string }[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new ApiError("VALIDATION_ERROR", "The file needs a heading row and at least one bill.");
  const head = cells(lines[0]);
  const col = (re: RegExp) => head.findIndex((h) => re.test(h.trim()));
  const ix = { name: col(HEADERS.name), phone: col(HEADERS.phone), amount: col(HEADERS.amount), invoice: col(HEADERS.invoice), due: col(HEADERS.due) };
  if (ix.phone < 0 || ix.amount < 0) throw new ApiError("VALIDATION_ERROR", "The file needs a Phone (or Mobile) column and an Amount (or Balance / Pending) column.");
  const rows: DueRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  for (const [i, line] of lines.slice(1, MAX_ROWS + 1).entries()) {
    const c = cells(line);
    const phone = normalizePhone(c[ix.phone] ?? "");
    const amount = Number((c[ix.amount] ?? "").replace(/[₹,\s]|rs\.?|inr|dr|cr/gi, ""));
    if (!phone) skipped.push({ line: i + 2, reason: "Phone number is missing or not valid." });
    else if (!Number.isFinite(amount) || amount <= 0) skipped.push({ line: i + 2, reason: "Amount is missing or zero." });
    else rows.push({ name: (ix.name >= 0 ? c[ix.name] ?? "" : "").slice(0, 120), phone, invoiceNo: (ix.invoice >= 0 ? c[ix.invoice] ?? "" : "").slice(0, 60), amountPaise: Math.round(amount * 100), dueDate: ix.due >= 0 ? parseDate(c[ix.due] ?? "") : null });
  }
  return { rows, skipped };
}

export const importSchema = z.object({ csv: z.string().min(5).max(600_000), consentConfirmed: z.boolean().default(false) });

export async function importDues(access: OrgAccess, input: z.infer<typeof importSchema>, req?: Request) {
  if (!input.consentConfirmed) throw new ApiError("VALIDATION_ERROR", "Confirm that these customers agreed to get WhatsApp messages from you.", { details: { consentConfirmed: ["Required"] } });
  const { rows, skipped } = parseDuesCsv(input.csv);
  const organizationId = access.organizationId;
  let added = 0;
  let updated = 0;
  for (const r of rows) {
    const existing = await db.dueReminder.findUnique({ where: { organizationId_phone_invoiceNo: { organizationId, phone: r.phone, invoiceNo: r.invoiceNo } } });
    if (existing) {
      if (existing.status !== "paid") await db.dueReminder.update({ where: { id: existing.id }, data: { name: r.name || existing.name, amountPaise: r.amountPaise, dueDate: r.dueDate } });
      updated++;
    } else {
      await db.dueReminder.create({ data: { organizationId, ...r } });
      added++;
    }
    // The customer becomes a contact with the consent the uploader confirmed, so the reminder template may be sent.
    let contact = await db.contact.findUnique({ where: { organizationId_phone: { organizationId, phone: r.phone } } });
    if (!contact) contact = await db.contact.create({ data: { organizationId, phone: r.phone, name: r.name, source: "import", lifecycle: "customer" } });
    if (contact.optInStatus === "unknown" || contact.optInStatus === "") {
      await recordConsent({ organizationId, actorUserId: access.user.id }, contact.id, { status: "opted_in", source: "import", evidence: "Unpaid bills upload: the business confirmed the customer agreed to WhatsApp messages." }, { silent: true });
    }
  }
  await audit({ action: "dues.imported", organizationId, actorUserId: access.user.id, targetType: "dues", metadata: { added, updated, skipped: skipped.length }, req });
  return { added, updated, skipped: skipped.slice(0, 20), skippedCount: skipped.length };
}

const dto = (d: { id: string; name: string; phone: string; invoiceNo: string; amountPaise: number; dueDate: Date | null; status: string; sentCount: number; lastSentAt: Date | null; error: string }) => d;

export async function listDues(organizationId: string) {
  const [items, totals] = await Promise.all([
    db.dueReminder.findMany({ where: { organizationId }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 500, select: { id: true, name: true, phone: true, invoiceNo: true, amountPaise: true, dueDate: true, status: true, sentCount: true, lastSentAt: true, error: true } }),
    db.dueReminder.groupBy({ by: ["status"], where: { organizationId }, _sum: { amountPaise: true }, _count: { _all: true } }),
  ]);
  const sum = (ss: string[]) => totals.filter((t) => ss.includes(t.status)).reduce((n, t) => n + (t._sum.amountPaise ?? 0), 0);
  return { items: items.map(dto), unpaidPaise: sum(["pending", "sent", "failed"]), paidPaise: sum(["paid"]), count: totals.reduce((n, t) => n + t._count._all, 0) };
}

export async function setDuePaid(access: OrgAccess, id: string, paid: boolean) {
  const d = await db.dueReminder.findFirst({ where: { id, organizationId: access.organizationId } });
  if (!d) throw new ApiError("NOT_FOUND", "Bill not found.");
  await db.dueReminder.update({ where: { id }, data: { status: paid ? "paid" : d.sentCount ? "sent" : "pending" } });
  return { id, paid };
}

export async function deleteDue(access: OrgAccess, id: string) {
  const r = await db.dueReminder.deleteMany({ where: { id, organizationId: access.organizationId } });
  if (!r.count) throw new ApiError("NOT_FOUND", "Bill not found.");
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const remindSchema = z.object({ whatsappAccountId: z.string().min(1), templateId: z.string().min(1), ids: z.array(z.string()).max(500).optional() });

/**
 * Sends the reminder template to every unpaid bill (or the chosen ones). The template's body variables are filled in
 * this order: {{1}} name, {{2}} amount, {{3}} bill number, {{4}} due date. A bill is not reminded twice in 24 hours.
 */
export async function sendDueReminders(access: OrgAccess, input: z.infer<typeof remindSchema>, req?: Request) {
  const organizationId = access.organizationId;
  const t = await requireApprovedTemplate(organizationId, null, { templateId: input.templateId });
  const slots = templateSlots(toDef(t));
  if (slots.some((s) => s.part !== "body")) throw new ApiError("VALIDATION_ERROR", "Pick a template with text only: no image header and no link button with a variable.", { details: { templateId: ["Not supported for reminders"] } });
  if (slots.length > 4) throw new ApiError("VALIDATION_ERROR", "The reminder template can use up to 4 variables: name, amount, bill number, due date.", { details: { templateId: ["Too many variables"] } });
  const dayAgo = new Date(Date.now() - 86_400_000);
  const dues = await db.dueReminder.findMany({
    where: { organizationId, status: { in: ["pending", "sent", "failed"] }, ...(input.ids?.length ? { id: { in: input.ids } } : {}), OR: [{ lastSentAt: null }, { lastSentAt: { lt: dayAgo } }] },
    take: 200,
    orderBy: { createdAt: "asc" },
  });
  let sent = 0;
  let failed = 0;
  for (const d of dues) {
    const fill = [d.name || "Customer", rupees(d.amountPaise), d.invoiceNo || "your bill", d.dueDate ? dayFmt.format(d.dueDate) : "as soon as possible"];
    const values: SlotValues = {};
    slots.forEach((s, i) => (values[s.key] = fill[i]));
    try {
      const bad = slots.map((s) => paramProblem(values[s.key])).find(Boolean);
      if (bad) throw new SystemSendError(`A value ${bad}.`);
      const contact = await db.contact.findUnique({ where: { organizationId_phone: { organizationId, phone: d.phone } } });
      if (!contact) throw new SystemSendError("The customer is not in Contacts. Upload the file again.");
      await sendTemplateToContact(organizationId, input.whatsappAccountId, contact.id, t.id, values, { origin: "due_reminder", dueId: d.id });
      await db.dueReminder.update({ where: { id: d.id }, data: { status: "sent", sentCount: { increment: 1 }, lastSentAt: new Date(), error: "" } });
      sent++;
    } catch (e) {
      await db.dueReminder.update({ where: { id: d.id }, data: { status: "failed", error: (e instanceof SystemSendError || e instanceof ApiError ? e.message : "The reminder couldn't be sent.").slice(0, 300) } });
      failed++;
    }
  }
  await audit({ action: "dues.reminded", organizationId, actorUserId: access.user.id, targetType: "dues", metadata: { sent, failed }, req });
  return { sent, failed, waiting: (await db.dueReminder.count({ where: { organizationId, status: { in: ["pending", "sent", "failed"] } } })) - dues.length };
}
