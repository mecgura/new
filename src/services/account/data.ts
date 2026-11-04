import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import type { OrgAccess } from "@/lib/session";
import { deleteClient } from "@/lib/services/clients";

/**
 * Workspace data rights: the owner can download a full JSON export at any time, and ask for the whole workspace to be
 * deleted. Deletion has a 7-day cooling-off period (the owner can cancel) and is then carried out by a Super Admin
 * with the existing client-deletion routine. Secrets (WhatsApp tokens, API key hashes, webhook secrets) are never exported.
 */
export const COOLING_OFF_DAYS = 7;
const MAX_ROWS = 50_000;
const DAY = 86_400_000;

function ownerOnly(access: OrgAccess) {
  if (access.role !== "CLIENT_OWNER") throw new ApiError("FORBIDDEN", "Only the workspace owner can do this.");
}
const parse = (s: string) => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return s;
  }
};

export async function exportWorkspace(access: OrgAccess, req?: Request) {
  ownerOnly(access);
  const organizationId = access.organizationId;
  const where = { organizationId };
  const [org, members, contacts, notes, consents, conversations, messages, deals, appointments, purchases, loyalty, reviews, templates, campaigns, automations, pages, submissions, invoices] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { id: true, name: true, slug: true, contactEmail: true, createdAt: true } }),
    db.organizationMember.findMany({ where, select: { role: true, createdAt: true, user: { select: { name: true, email: true } } } }),
    db.contact.findMany({ where, take: MAX_ROWS, select: { id: true, name: true, phone: true, email: true, lifecycle: true, leadStatus: true, source: true, optInStatus: true, suppressed: true, customFields: true, createdAt: true, tags: { select: { tag: { select: { name: true } } } } } }),
    db.contactNote.findMany({ where, take: MAX_ROWS, select: { contactId: true, body: true, createdAt: true } }),
    db.consentRecord.findMany({ where, take: MAX_ROWS, select: { contactId: true, status: true, channel: true, source: true, evidence: true, createdAt: true } }),
    db.conversation.findMany({ where, take: MAX_ROWS, select: { id: true, contactId: true, channel: true, status: true, createdAt: true } }),
    db.message.findMany({ where, take: MAX_ROWS, orderBy: { createdAt: "asc" }, select: { conversationId: true, direction: true, type: true, body: true, status: true, createdAt: true } }),
    db.deal.findMany({ where, take: MAX_ROWS, select: { contactId: true, title: true, valuePaise: true, status: true, expectedCloseAt: true, closedAt: true, createdAt: true, stage: { select: { name: true } } } }),
    db.appointment.findMany({ where, take: MAX_ROWS, select: { contactId: true, service: true, requestedFor: true, startsAt: true, status: true, createdAt: true } }),
    db.purchase.findMany({ where, take: MAX_ROWS, select: { contactId: true, amountPaise: true, note: true, createdAt: true } }),
    db.loyaltyEntry.findMany({ where, take: MAX_ROWS, select: { contactId: true, points: true, kind: true, status: true, note: true, createdAt: true } }),
    db.reviewRequest.findMany({ where, take: MAX_ROWS, select: { contactId: true, rating: true, comment: true, sentAt: true, ratedAt: true } }),
    db.messageTemplate.findMany({ where, select: { name: true, language: true, category: true, status: true, createdAt: true } }),
    db.campaign.findMany({ where, select: { name: true, status: true, createdAt: true } }),
    db.automation.findMany({ where, select: { name: true, status: true, createdAt: true } }),
    db.landingPage.findMany({ where, select: { title: true, slug: true, status: true, createdAt: true } }),
    db.landingSubmission.findMany({ where, take: MAX_ROWS, select: { contactId: true, data: true, utmSource: true, utmCampaign: true, createdAt: true } }),
    db.invoice.findMany({ where, select: { number: true, status: true, total: true, issuedAt: true, paidAt: true } }),
  ]);
  const data = {
    exportedAt: new Date().toISOString(),
    format: "MECGURA workspace export v1 (amounts in paise; secrets and credentials are not included)",
    truncated: [contacts, messages, conversations].some((l) => l.length >= MAX_ROWS),
    organization: org,
    members: members.map((m) => ({ name: m.user.name, email: m.user.email, role: m.role, since: m.createdAt })),
    contacts: contacts.map((c) => ({ ...c, customFields: parse(c.customFields), tags: c.tags.map((t) => t.tag.name) })),
    contactNotes: notes,
    consentHistory: consents,
    conversations,
    messages,
    deals: deals.map((d) => ({ ...d, stage: d.stage.name })),
    appointments,
    purchases,
    loyalty,
    reviews,
    templates,
    campaigns,
    automations,
    landingPages: pages,
    landingSubmissions: submissions.map((s) => ({ ...s, data: parse(s.data) })),
    invoices,
  };
  await audit({ action: "workspace.exported", actorUserId: access.user.id, organizationId, targetType: "organization", targetId: organizationId, metadata: { contacts: contacts.length, messages: messages.length }, req });
  return { filename: `mecgura-${org.slug}-export-${new Date().toISOString().slice(0, 10)}.json`, body: JSON.stringify(data, null, 1) };
}

export async function deletionStatus(organizationId: string) {
  const r = await db.dataRequest.findFirst({ where: { organizationId, status: "pending" }, orderBy: { createdAt: "desc" } });
  return r ? { id: r.id, status: r.status, earliestAt: r.earliestAt, createdAt: r.createdAt, reason: r.reason } : null;
}

export async function requestDeletion(access: OrgAccess, input: { confirmName: string; reason: string }, req?: Request) {
  ownerOnly(access);
  const org = await db.organization.findUniqueOrThrow({ where: { id: access.organizationId }, select: { name: true } });
  if (input.confirmName.trim() !== org.name) throw new ApiError("VALIDATION_ERROR", "Type the workspace name exactly to confirm.", { details: { confirmName: ["Doesn't match the workspace name"] } });
  if (await deletionStatus(access.organizationId)) throw new ApiError("CONFLICT", "A deletion request is already pending.");
  const r = await db.dataRequest.create({
    data: { organizationId: access.organizationId, organizationName: org.name, requestedById: access.user.id, requestedByEmail: access.user.email, reason: input.reason.slice(0, 500), earliestAt: new Date(Date.now() + COOLING_OFF_DAYS * DAY) },
  });
  await audit({ action: "workspace.deletion_requested", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "data_request", targetId: r.id, metadata: { earliestAt: r.earliestAt }, req });
  const admins = await db.user.findMany({ where: { role: "SUPER_ADMIN", status: "active" }, select: { id: true } });
  for (const a of admins) await notify({ userId: a.id, type: "warning", title: `Deletion requested: ${org.name}`, body: `Can be carried out from ${r.earliestAt.toDateString()}. Admin → Security.`, link: "/admin/security" });
  return deletionStatus(access.organizationId);
}

export async function cancelDeletion(access: OrgAccess, req?: Request) {
  ownerOnly(access);
  const r = await db.dataRequest.findFirst({ where: { organizationId: access.organizationId, status: "pending" } });
  if (!r) throw new ApiError("NOT_FOUND", "There's no pending deletion request.");
  await db.dataRequest.update({ where: { id: r.id }, data: { status: "cancelled", decidedById: access.user.id, decidedAt: new Date(), note: "Cancelled by the owner" } });
  await audit({ action: "workspace.deletion_cancelled", actorUserId: access.user.id, organizationId: access.organizationId, targetType: "data_request", targetId: r.id, req });
}

export async function adminDataRequests() {
  return db.dataRequest.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
}

/** Super Admin carries out a pending request after the cooling-off period, or rejects it with a note. */
export async function decideDeletion(adminId: string, id: string, input: { decision: "execute" | "reject"; note: string }, req?: Request) {
  const r = await db.dataRequest.findUnique({ where: { id } });
  if (!r || r.status !== "pending") throw new ApiError("NOT_FOUND", "No pending request with that id.");
  if (input.decision === "reject") {
    await db.dataRequest.update({ where: { id }, data: { status: "rejected", decidedById: adminId, decidedAt: new Date(), note: input.note.slice(0, 500) } });
    await audit({ action: "workspace.deletion_rejected", actorUserId: adminId, organizationId: r.organizationId, targetType: "data_request", targetId: id, metadata: { note: input.note.slice(0, 200) }, req });
    return { status: "rejected" as const };
  }
  if (Date.now() < r.earliestAt.getTime()) throw new ApiError("CONFLICT", `The owner can still cancel until ${r.earliestAt.toDateString()}.`);
  const org = await db.organization.findUnique({ where: { id: r.organizationId }, select: { name: true } });
  if (org) await deleteClient(adminId, r.organizationId, org.name, req);
  await db.dataRequest.update({ where: { id }, data: { status: "completed", decidedById: adminId, decidedAt: new Date(), note: input.note.slice(0, 500) } });
  await audit({ action: "workspace.deletion_executed", actorUserId: adminId, targetType: "data_request", targetId: id, metadata: { organization: r.organizationName }, req });
  return { status: "completed" as const };
}
