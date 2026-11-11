import "server-only";
import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import type { TenantRequestContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { assertPermission } from "@/lib/permissions";
import { rateLimit } from "@/lib/security/rate-limit";
import { tenantDb } from "@/lib/tenant/db";
import { parseOrThrow } from "@/lib/validation";
import { contactSchema } from "@/lib/validation/website";
import { parseContent } from "@/lib/website/content";
import { containsCI, pageParams } from "./shared";

const ipHash = (ip: string | null) => (ip ? createHmac("sha256", process.env.AUTH_SECRET ?? "dev").update(ip).digest("hex").slice(0, 24) : null);

/**
 * Public contact form → enquiry stored under the clinic resolved from the HOST (tenantId is never read from the body).
 * Abuse controls: honeypot, per-IP and per-clinic rate limits, strict validation + length caps, consent required,
 * and only a salted hash of the IP is kept.
 */
export async function submitEnquiry(tenantId: string, raw: unknown, ip: string | null) {
  const w = await db.website.findUnique({ where: { tenantId }, select: { status: true, publishedContent: true } });
  const content = w?.status === "PUBLISHED" ? parseContent(w.publishedContent) : null;
  if (!content || !content.contact.showForm || !content.pages.contact) throw new AppError("NOT_FOUND");
  const hash = ipHash(ip);
  const [perIp, perClinic] = await Promise.all([
    rateLimit(`enq:${tenantId}:${hash ?? "?"}`, { limit: 5, windowMs: 60 * 60_000 }),
    rateLimit(`enq:${tenantId}:all`, { limit: 100, windowMs: 60 * 60_000 }),
  ]);
  if (!perIp.allowed || !perClinic.allowed) throw new AppError("RATE_LIMITED");
  const input = parseOrThrow(contactSchema, raw);
  if (input.website_url) return { received: true }; // bot: pretend success, store nothing
  const row = await db.contactEnquiry.create({ data: { tenantId, name: input.name, phone: input.phone, email: input.email, message: input.message, consent: true, ipHash: hash }, select: { id: true } });
  await recordAudit({ action: AUDIT_ACTIONS.ENQUIRY_RECEIVED, tenantId, entityType: "enquiry", entityId: row.id, ip: null, userAgent: null });
  return { received: true };
}

export async function listEnquiries(ctx: TenantRequestContext, f: { status?: string; q?: string; page?: number }) {
  assertPermission(ctx.permissions, "enquiries.view");
  const { skip, take, page } = pageParams(f.page);
  const where = { ...(f.status && ["NEW", "READ", "ARCHIVED"].includes(f.status) ? { status: f.status } : {}), ...(f.q ? { OR: [{ name: containsCI(f.q) }, { message: containsCI(f.q) }, { phone: containsCI(f.q) }, { email: containsCI(f.q) }] } : {}) };
  const tdb = tenantDb(ctx);
  const [total, rows] = await Promise.all([tdb.contactEnquiry.count({ where }), tdb.contactEnquiry.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, select: { id: true, name: true, phone: true, email: true, message: true, status: true, createdAt: true } })]);
  return { total, page, pageSize: take, rows };
}

export async function setEnquiryStatus(ctx: TenantRequestContext, id: string, status: "NEW" | "READ" | "ARCHIVED") {
  assertPermission(ctx.permissions, "enquiries.manage");
  const tdb = tenantDb(ctx);
  const cur = await tdb.contactEnquiry.findFirst({ where: { id }, select: { status: true } });
  if (!cur) throw new AppError("NOT_FOUND");
  await tdb.contactEnquiry.update({ where: { id }, data: { status } });
  await recordAudit({ action: AUDIT_ACTIONS.ENQUIRY_STATUS_CHANGED, tenantId: ctx.tenantId, actorId: ctx.user.id, entityType: "enquiry", entityId: id, metadata: { from: cur.status, to: status } });
  return { status };
}
