import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { sendMail, isEmailConfigured } from "@/lib/mailer";
import { siteConfig } from "@/config/site";

/**
 * Support desk between clients and MECGURA. Clients open tickets from their workspace; the Super Admin answers,
 * assigns, writes internal notes and resolves. Every ticket has a first-response deadline by priority; missed
 * deadlines are escalated to all Super Admins by the scheduler.
 */

export const CATEGORIES = ["whatsapp", "billing", "campaigns", "automations", "ai", "landing", "other"] as const;
export const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = { whatsapp: "WhatsApp number / messages", billing: "Billing & wallet", campaigns: "Campaigns & templates", automations: "Automations & flows", ai: "AI agent", landing: "Landing pages & website", other: "Something else" };
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
/** First-response target in hours. */
export const SLA_HOURS: Record<Priority, number> = { urgent: 2, high: 8, normal: 24, low: 72 };
export const STATUSES = ["open", "waiting", "resolved", "closed"] as const;

const MAX_FILE = 5 * 1024 * 1024;
const FILE_TYPES = /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/;
const attachmentSchema = z.object({ filename: z.string().trim().min(1).max(120).regex(/^[^/\\]+$/), data: z.string().max(7_200_000).regex(FILE_TYPES, "Attach a PNG, JPG, WebP or PDF") }).strict();

export const createSchema = z
  .object({
    subject: z.string().trim().min(5, "Describe the problem in a few words").max(150),
    category: z.enum(CATEGORIES),
    priority: z.enum(PRIORITIES).default("normal"),
    body: z.string().trim().min(10, "Tell us what happened").max(5000),
    attachments: z.array(attachmentSchema).max(3).default([]),
  })
  .strict();
export const replySchema = z.object({ body: z.string().trim().min(1).max(5000), attachments: z.array(attachmentSchema).max(3).default([]) }).strict();
export const adminReplySchema = replySchema.extend({ internal: z.boolean().default(false), status: z.enum(STATUSES).optional() }).strict();
export const adminUpdateSchema = z.object({ status: z.enum(STATUSES), priority: z.enum(PRIORITIES), assigneeId: z.string().max(40).nullable() }).partial().strict();

type Actor = { userId: string; req?: Request };

const dueFrom = (from: Date, p: Priority) => new Date(from.getTime() + SLA_HOURS[p] * 3_600_000);

function decode(files: z.infer<typeof attachmentSchema>[]) {
  return files.map((f) => {
    const mimeType = f.data.slice(5, f.data.indexOf(";"));
    const bytes = Buffer.from(f.data.slice(f.data.indexOf(",") + 1), "base64");
    if (bytes.length > MAX_FILE) throw new ApiError("VALIDATION_ERROR", `${f.filename} is over 5 MB.`, { details: { attachments: ["Too large"] } });
    const sig = bytes.subarray(0, 4).toString("hex");
    const ok = (mimeType === "application/pdf" && bytes.subarray(0, 4).toString() === "%PDF") || (mimeType === "image/png" && sig === "89504e47") || (mimeType === "image/jpeg" && sig.startsWith("ffd8")) || (mimeType === "image/webp" && bytes.subarray(8, 12).toString() === "WEBP");
    if (!ok) throw new ApiError("VALIDATION_ERROR", `${f.filename} doesn't look like a real ${mimeType.split("/")[1].toUpperCase()} file.`, { details: { attachments: ["Unreadable file"] } });
    return { filename: f.filename, mimeType, size: bytes.length, data: new Uint8Array(bytes) };
  });
}

async function admins() {
  return (await db.user.findMany({ where: { role: "SUPER_ADMIN", status: "active" }, select: { id: true } })).map((u) => u.id);
}

async function nextNumber() {
  const last = await db.supportTicket.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
  return (last?.number ?? 1000) + 1;
}

export async function createTicket(organizationId: string, actor: Actor, input: z.infer<typeof createSchema>) {
  const files = decode(input.attachments);
  const now = new Date();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const t = await db.supportTicket.create({
        data: {
          number: await nextNumber(),
          organizationId,
          createdById: actor.userId,
          subject: input.subject,
          category: input.category,
          priority: input.priority,
          slaDueAt: dueFrom(now, input.priority),
          messages: { create: { authorId: actor.userId, body: input.body, ...(files.length ? { attachments: { create: files } } : {}) } },
        },
        include: { organization: { select: { name: true } } },
      });
      await audit({ action: "support.ticket_created", actorUserId: actor.userId, organizationId, targetType: "support_ticket", targetId: t.id, metadata: { number: t.number, priority: t.priority }, req: actor.req });
      for (const id of await admins()) await notify({ userId: id, type: input.priority === "urgent" || input.priority === "high" ? "warning" : "info", title: `#${t.number} ${input.priority === "urgent" ? "URGENT · " : ""}${t.organization.name}`, body: input.subject, link: `/admin/support?ticket=${t.id}` });
      return getTicket(organizationId, t.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // two tickets took the same number
      throw e;
    }
  }
  throw new ApiError("SERVICE_UNAVAILABLE", "Couldn't open the ticket. Please try again.");
}

const msgSelect = (withInternal: boolean) => ({
  where: withInternal ? {} : { internal: false },
  orderBy: { createdAt: "asc" as const },
  select: { id: true, body: true, fromSupport: true, internal: true, createdAt: true, author: { select: { id: true, name: true } }, attachments: { select: { id: true, filename: true, mimeType: true, size: true } } },
});

function ticketDto<T extends { slaDueAt: Date; firstResponseAt: Date | null; status: string }>(t: T, now = Date.now()) {
  const breached = !t.firstResponseAt && t.status === "open" && t.slaDueAt.getTime() < now;
  return { ...t, breached };
}

/** A client's own ticket (internal notes never included). */
export async function getTicket(organizationId: string, id: string) {
  const t = await db.supportTicket.findFirst({ where: { id, organizationId }, include: { messages: msgSelect(false), createdBy: { select: { name: true } } } });
  if (!t) throw new ApiError("NOT_FOUND", "Ticket not found.");
  return ticketDto(t);
}

export async function listOrgTickets(organizationId: string) {
  const rows = await db.supportTicket.findMany({ where: { organizationId }, orderBy: { lastActivityAt: "desc" }, take: 200, include: { createdBy: { select: { name: true } }, _count: { select: { messages: { where: { internal: false } } } } } });
  return rows.map((t) => ticketDto(t));
}

/** The client writes back: a waiting or resolved ticket opens again. */
export async function clientReply(organizationId: string, actor: Actor, id: string, input: z.infer<typeof replySchema>) {
  const t = await db.supportTicket.findFirst({ where: { id, organizationId } });
  if (!t) throw new ApiError("NOT_FOUND", "Ticket not found.");
  if (t.status === "closed") throw new ApiError("CONFLICT", "This ticket is closed. Open a new one and mention #" + t.number + ".");
  const files = decode(input.attachments);
  await db.supportTicket.update({ where: { id }, data: { status: "open", lastActivityAt: new Date(), ...(t.status === "resolved" ? { resolvedAt: null } : {}), messages: { create: { authorId: actor.userId, body: input.body, ...(files.length ? { attachments: { create: files } } : {}) } } } });
  for (const uid of t.assigneeId ? [t.assigneeId] : await admins()) await notify({ userId: uid, type: "info", title: `#${t.number} new reply`, body: input.body.slice(0, 140), link: `/admin/support?ticket=${t.id}` });
  return getTicket(organizationId, id);
}

/** The client says it's sorted. */
export async function clientResolve(organizationId: string, actor: Actor, id: string) {
  const t = await db.supportTicket.findFirst({ where: { id, organizationId } });
  if (!t) throw new ApiError("NOT_FOUND", "Ticket not found.");
  await db.supportTicket.update({ where: { id }, data: { status: "resolved", resolvedAt: new Date(), lastActivityAt: new Date() } });
  await audit({ action: "support.ticket_updated", actorUserId: actor.userId, organizationId, targetType: "support_ticket", targetId: id, metadata: { status: "resolved", by: "client" }, req: actor.req });
  return getTicket(organizationId, id);
}

export async function attachmentFor(id: string, scope: { organizationId: string } | "admin") {
  const a = await db.supportAttachment.findUnique({ where: { id }, include: { message: { select: { internal: true, ticket: { select: { organizationId: true } } } } } });
  if (!a) return null;
  if (scope !== "admin" && (a.message.internal || a.message.ticket.organizationId !== scope.organizationId)) return null;
  return a;
}

// ---------------------------------------------------------------------------
// MECGURA side
// ---------------------------------------------------------------------------
export const adminListSchema = z.object({ status: z.enum(["active", ...STATUSES, "all"]).default("active"), priority: z.enum(PRIORITIES).optional(), breached: z.coerce.boolean().optional(), q: z.string().trim().max(80).optional() });

export async function adminList(q: z.infer<typeof adminListSchema>, now = new Date()) {
  const term = q.q?.trim();
  const num = term && /^#?\d+$/.test(term) ? Number(term.replace("#", "")) : null;
  const rows = await db.supportTicket.findMany({
    where: {
      ...(q.status === "active" ? { status: { in: ["open", "waiting"] } } : q.status === "all" ? {} : { status: q.status }),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.breached ? { firstResponseAt: null, status: "open", slaDueAt: { lt: now } } : {}),
      ...(term ? (num ? { number: num } : { OR: [{ subject: { contains: term } }, { organization: { name: { contains: term } } }] }) : {}),
    },
    include: { organization: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } }, createdBy: { select: { name: true, email: true } } },
    orderBy: [{ lastActivityAt: "desc" }],
    take: 300,
  });
  const rank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  return rows.map((t) => ticketDto(t, now.getTime())).sort((a, b) => Number(b.breached) - Number(a.breached) || (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || rank[a.priority] - rank[b.priority]);
}

export async function adminGet(id: string) {
  const t = await db.supportTicket.findUnique({ where: { id }, include: { messages: msgSelect(true), organization: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } }, createdBy: { select: { name: true, email: true } } } });
  if (!t) throw new ApiError("NOT_FOUND", "Ticket not found.");
  return ticketDto(t);
}

/** MECGURA replies (or writes an internal note). The first public reply stops the SLA clock; the client is told. */
export async function adminReply(actor: Actor, id: string, input: z.infer<typeof adminReplySchema>) {
  const t = await db.supportTicket.findUnique({ where: { id }, include: { createdBy: { select: { id: true, email: true, name: true } } } });
  if (!t) throw new ApiError("NOT_FOUND", "Ticket not found.");
  const files = decode(input.attachments);
  const now = new Date();
  const status = input.status ?? (input.internal ? t.status : t.status === "open" ? "waiting" : t.status);
  await db.supportTicket.update({
    where: { id },
    data: {
      status,
      lastActivityAt: now,
      ...(!input.internal && !t.firstResponseAt ? { firstResponseAt: now } : {}),
      ...(status === "resolved" && !t.resolvedAt ? { resolvedAt: now } : status === "open" || status === "waiting" ? { resolvedAt: null } : {}),
      ...(!t.assigneeId ? { assigneeId: actor.userId } : {}),
      messages: { create: { authorId: actor.userId, body: input.body, fromSupport: true, internal: input.internal, ...(files.length ? { attachments: { create: files } } : {}) } },
    },
  });
  if (!input.internal && t.createdBy) {
    await notify({ userId: t.createdBy.id, type: "info", title: `MECGURA replied to #${t.number}`, body: input.body.slice(0, 160), link: `/support?ticket=${t.id}` });
    if (isEmailConfigured()) await sendMail(t.createdBy.email, `Re: #${t.number} ${t.subject}`, `${input.body}\n\n—\nReply in your MECGURA workspace: ${siteConfig.url}/support?ticket=${t.id}`).catch(() => null);
  }
  await audit({ action: "support.ticket_updated", actorUserId: actor.userId, organizationId: t.organizationId, targetType: "support_ticket", targetId: id, metadata: { reply: true, internal: input.internal, status }, req: actor.req });
  return adminGet(id);
}

export async function adminUpdate(actor: Actor, id: string, input: z.infer<typeof adminUpdateSchema>) {
  const t = await db.supportTicket.findUnique({ where: { id } });
  if (!t) throw new ApiError("NOT_FOUND", "Ticket not found.");
  if (input.assigneeId && !(await db.user.count({ where: { id: input.assigneeId, role: "SUPER_ADMIN" } }))) throw new ApiError("VALIDATION_ERROR", "Assign to a MECGURA admin.");
  const now = new Date();
  await db.supportTicket.update({
    where: { id },
    data: {
      ...(input.status ? { status: input.status, ...(input.status === "resolved" || input.status === "closed" ? { resolvedAt: t.resolvedAt ?? now } : { resolvedAt: null }) } : {}),
      // A new priority moves the deadline while nobody has answered yet.
      ...(input.priority ? { priority: input.priority, ...(!t.firstResponseAt ? { slaDueAt: dueFrom(t.createdAt, input.priority), escalatedAt: null } : {}) } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      lastActivityAt: now,
    },
  });
  await audit({ action: "support.ticket_updated", actorUserId: actor.userId, organizationId: t.organizationId, targetType: "support_ticket", targetId: id, metadata: input, req: actor.req });
  return adminGet(id);
}

/** Scheduler: tickets past their first-response deadline are escalated to every Super Admin once. */
export async function escalateBreaches(now = new Date()) {
  const due = await db.supportTicket.findMany({ where: { status: "open", firstResponseAt: null, escalatedAt: null, slaDueAt: { lt: now } }, include: { organization: { select: { name: true } } }, take: 50 });
  if (!due.length) return 0;
  const ids = await admins();
  for (const t of due) {
    const r = await db.supportTicket.updateMany({ where: { id: t.id, escalatedAt: null }, data: { escalatedAt: now } });
    if (!r.count) continue;
    for (const uid of ids) await notify({ userId: uid, type: "warning", title: `SLA missed: #${t.number} (${t.priority})`, body: `${t.organization.name}: ${t.subject}`, link: `/admin/support?ticket=${t.id}` });
  }
  return due.length;
}

/** Resolution report for the last N days. */
export async function supportReport(days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db.supportTicket.findMany({ where: { createdAt: { gte: since } }, select: { category: true, priority: true, status: true, createdAt: true, firstResponseAt: true, resolvedAt: true, slaDueAt: true } });
  const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;
  const responded = rows.filter((r) => r.firstResponseAt);
  const resolved = rows.filter((r) => r.resolvedAt);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const slaKnown = rows.filter((r) => r.firstResponseAt || r.slaDueAt < now);
  return {
    created: rows.length,
    resolved: resolved.length,
    open: await db.supportTicket.count({ where: { status: { in: ["open", "waiting"] } } }),
    breachedNow: await db.supportTicket.count({ where: { status: "open", firstResponseAt: null, slaDueAt: { lt: now } } }),
    avgFirstResponseHours: avg(responded.map((r) => hours(r.createdAt, r.firstResponseAt!))),
    avgResolutionHours: avg(resolved.map((r) => hours(r.createdAt, r.resolvedAt!))),
    slaMetPct: slaKnown.length ? Math.round((slaKnown.filter((r) => r.firstResponseAt && r.firstResponseAt <= r.slaDueAt).length / slaKnown.length) * 100) : null,
    byCategory: CATEGORIES.map((c) => ({ category: c, count: rows.filter((r) => r.category === c).length })).filter((c) => c.count),
    byPriority: PRIORITIES.map((p) => ({ priority: p, count: rows.filter((r) => r.priority === p).length })),
  };
}
