import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { OrgAccess, SessionUser } from "@/lib/session";
import type { ApiPrincipal } from "@/lib/api-auth";
import { templateSlots } from "@/lib/templates";
import { assertTemplateValues, sendMessage, type SendInput } from "@/services/inbox/messaging";
import { createContact, getContactDetail, listContacts, normalizePhone, updateContact, type ContactInput } from "@/services/inbox/contacts";
import { requireApprovedTemplate, toDef } from "@/services/templates/templates";
import { emitConversationCreated } from "@/services/webhooks/events";
import type { z } from "zod";
import type { apiContactCreateSchema, apiContactUpdateSchema, apiSendSchema } from "@/lib/api-public";

// ---------------------------------------------------------------------------
// Output shapes (snake_case, no internal ids of people, no secrets)
// ---------------------------------------------------------------------------

type ContactLike = { id: string; name: string; phone: string; email: string; lifecycle: string; leadStatus: string; source: string; optInStatus: string; suppressed: boolean; customFields: Record<string, string>; tags: { name: string }[]; lastMessageAt: Date | null; createdAt: Date };
const contactOut = (c: ContactLike) => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  lifecycle: c.lifecycle,
  lead_status: c.leadStatus,
  source: c.source,
  opt_in_status: c.optInStatus,
  suppressed: c.suppressed,
  tags: c.tags.map((t) => t.name),
  custom_fields: c.customFields,
  last_message_at: c.lastMessageAt,
  created_at: c.createdAt,
});

const ctxOf = (p: ApiPrincipal, req?: Request) => ({ organizationId: p.organizationId, actorUserId: null, req });
const page = <T>(items: T[], total: number, q: { page: number; pageSize: number }) => ({ data: items, page: q.page, page_size: q.pageSize, total, has_more: q.page * q.pageSize < total });

// ---------------------------------------------------------------------------
// Numbers, templates
// ---------------------------------------------------------------------------

export async function apiNumbers(p: ApiPrincipal) {
  const rows = await db.whatsAppAccount.findMany({
    where: { organizationId: p.organizationId, status: { in: ["connected", "demo"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, phoneNumber: true, status: true, isDemo: true, phone: { select: { qualityRating: true } } },
  });
  return { data: rows.map((a) => ({ id: a.id, name: a.displayName, phone: a.phoneNumber, status: a.status, demo: a.isDemo, quality: a.phone?.qualityRating ?? "UNKNOWN" })) };
}

export async function apiTemplates(p: ApiPrincipal) {
  const [rows, accounts] = await Promise.all([
    db.messageTemplate.findMany({ where: { organizationId: p.organizationId, status: "approved" }, orderBy: { name: "asc" }, take: 200 }),
    db.whatsAppAccount.findMany({ where: { organizationId: p.organizationId, status: { in: ["connected", "demo"] } }, select: { id: true, wabaRecordId: true } }),
  ]);
  return {
    data: rows.map((t) => ({
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      /** Numbers this template can be sent from (a template belongs to one WhatsApp Business Account). */
      number_ids: accounts.filter((a) => a.wabaRecordId && a.wabaRecordId === t.wabaRecordId).map((a) => a.id),
      variables: templateSlots(toDef(t)).map((s) => ({ key: s.key, label: s.label })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function apiListContacts(p: ApiPrincipal, q: { page: number; pageSize: number; q: string; phone: string }) {
  const phone = q.phone ? normalizePhone(q.phone) : null;
  const r = await listContacts(p.organizationId, { tab: "all", q: phone ? phone.replace(/\D/g, "") : q.q, page: q.page, pageSize: q.pageSize });
  return page(r.items.map(contactOut), r.total, q);
}

export async function apiGetContact(p: ApiPrincipal, id: string) {
  const d = await getContactDetail(p.organizationId, id);
  return { data: contactOut(d.contact) };
}

export async function apiCreateContact(p: ApiPrincipal, input: z.infer<typeof apiContactCreateSchema>, req?: Request) {
  const body: ContactInput & { phone: string } = {
    phone: input.phone,
    name: input.name,
    email: input.email,
    lifecycle: input.lifecycle,
    leadStatus: input.lead_status,
    customFields: input.custom_fields,
    tags: input.tags,
    source: "api",
    ...(input.opt_in ? { optInStatus: "opted_in" as const, consentEvidence: `API: ${input.opt_in.evidence}` } : {}),
  };
  const c = await createContact(ctxOf(p, req), body);
  return { data: contactOut(c) };
}

export async function apiUpdateContact(p: ApiPrincipal, id: string, input: z.infer<typeof apiContactUpdateSchema>, req?: Request) {
  const c = await updateContact(ctxOf(p, req), id, {
    phone: input.phone,
    name: input.name,
    email: input.email,
    lifecycle: input.lifecycle,
    leadStatus: input.lead_status,
    customFields: input.custom_fields,
    tags: input.tags,
  });
  return { data: contactOut(c) };
}

// ---------------------------------------------------------------------------
// Conversations and messages
// ---------------------------------------------------------------------------

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function apiListConversations(p: ApiPrincipal, q: { page: number; pageSize: number; number_id: string }) {
  if (q.number_id) await requireNumber(p, q.number_id);
  const where = { organizationId: p.organizationId, ...(q.number_id ? { whatsappAccountId: q.number_id } : {}) };
  const [rows, total] = await Promise.all([
    db.conversation.findMany({ where, orderBy: { lastMessageAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { contact: { select: { id: true, name: true, phone: true } } } }),
    db.conversation.count({ where }),
  ]);
  return page(
    rows.map((c) => ({
      id: c.id,
      number_id: c.whatsappAccountId,
      status: c.status,
      contact: c.contact,
      last_message_at: c.lastMessageAt,
      last_message_preview: c.lastMessagePreview,
      window_open: Boolean(c.lastInboundAt && Date.now() - c.lastInboundAt.getTime() < WINDOW_MS),
      demo: c.isDemo,
      created_at: c.createdAt,
    })),
    total,
    q
  );
}

export async function apiListMessages(p: ApiPrincipal, conversationId: string, q: { page: number; pageSize: number }) {
  const conv = await db.conversation.findFirst({ where: { id: conversationId, organizationId: p.organizationId }, select: { id: true } });
  if (!conv) throw new ApiError("NOT_FOUND", "Conversation not found.");
  const where = { conversationId: conv.id, organizationId: p.organizationId, direction: { in: ["inbound", "outbound"] } };
  const [rows, total] = await Promise.all([
    db.message.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.message.count({ where }),
  ]);
  return page(
    rows.map((m) => ({ id: m.id, direction: m.direction, type: m.type, text: m.body, status: m.status, error: m.error || null, created_at: m.createdAt, sent_at: m.sentAt, delivered_at: m.deliveredAt, read_at: m.readAt })),
    total,
    q
  );
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

async function requireNumber(p: ApiPrincipal, id: string) {
  const a = await db.whatsAppAccount.findFirst({ where: { id, organizationId: p.organizationId, status: { in: ["connected", "demo"] } } });
  if (!a) throw new ApiError("NOT_FOUND", "WhatsApp number not found.");
  return a;
}

/** `number_id` is optional only when the workspace has exactly one usable number — never guessed between several. */
async function resolveNumber(p: ApiPrincipal, numberId: string | undefined) {
  if (numberId) return requireNumber(p, numberId);
  const all = await db.whatsAppAccount.findMany({ where: { organizationId: p.organizationId, status: { in: ["connected", "demo"] } }, take: 2 });
  if (all.length === 1) return all[0];
  if (!all.length) throw new ApiError("CONFLICT", "This workspace has no connected WhatsApp number.");
  throw new ApiError("VALIDATION_ERROR", "This workspace has several WhatsApp numbers — say which one to send from.", { details: { number_id: ["Required when there is more than one number (see GET /api/v1/numbers)"] } });
}

/** The key acts as a workspace-level principal. Messages are attributed to the key's creator (or an owner) and marked origin "api". */
async function actingAccess(p: ApiPrincipal): Promise<OrgAccess> {
  const member =
    (p.createdById ? await db.organizationMember.findFirst({ where: { organizationId: p.organizationId, userId: p.createdById, user: { status: "active" } }, include: { user: true } }) : null) ??
    (await db.organizationMember.findFirst({ where: { organizationId: p.organizationId, role: "CLIENT_OWNER", user: { status: "active" } }, include: { user: true } }));
  if (!member) throw new ApiError("CONFLICT", "This workspace has no active owner to send on behalf of.");
  const user: SessionUser = { id: member.user.id, email: member.user.email, name: member.user.name, platformRole: "USER", memberships: [] };
  return { user, organizationId: p.organizationId, role: "CLIENT_OWNER", isPlatformAdmin: false };
}

export async function apiSend(p: ApiPrincipal, input: z.infer<typeof apiSendSchema>, req?: Request) {
  const account = await resolveNumber(p, input.number_id);
  const phone = normalizePhone(input.to);
  if (!phone) throw new ApiError("VALIDATION_ERROR", "“to” must be a phone number in international format, e.g. +919876543210.", { details: { to: ["Invalid phone number"] } });

  let send: SendInput;
  if (input.type === "text") {
    send = { type: "text", body: input.text! };
  } else {
    const t = await requireApprovedTemplate(p.organizationId, account.wabaRecordId, { name: input.template!.name, language: input.template!.language });
    assertTemplateValues(t, input.template!.values);
    send = { type: "template", templateId: t.id, values: input.template!.values };
  }

  const ctx = ctxOf(p, req);
  let contact = await db.contact.findUnique({ where: { organizationId_phone: { organizationId: p.organizationId, phone } } });
  if (!contact) {
    const c = await createContact(ctx, { phone, source: "api" });
    contact = await db.contact.findUniqueOrThrow({ where: { id: c.id } });
  }
  // Marketing templates need recorded consent — the API can't be used to bypass it.
  if (send.type === "template") {
    const t = await db.messageTemplate.findUniqueOrThrow({ where: { id: send.templateId } });
    if (t.category === "MARKETING" && contact.optInStatus !== "opted_in") {
      throw new ApiError("CONFLICT", "This contact hasn't opted in to marketing messages. Record consent first (POST /api/v1/contacts with opt_in), or use a utility template.");
    }
  }
  let conv = await db.conversation.findUnique({ where: { whatsappAccountId_contactId: { whatsappAccountId: account.id, contactId: contact.id } } });
  if (!conv) {
    conv = await db.conversation.create({ data: { organizationId: p.organizationId, contactId: contact.id, whatsappAccountId: account.id, isDemo: account.isDemo, lastMessagePreview: "" } });
    await emitConversationCreated(p.organizationId, conv.id);
  }
  const access = await actingAccess(p);
  const m = await sendMessage(access, conv.id, send, undefined, { origin: { origin: "api", apiKeyId: p.keyId } });
  return {
    data: { id: m.id, conversation_id: conv.id, number_id: account.id, to: phone, type: m.type, status: m.status, error: m.error || null, created_at: m.createdAt },
  };
}
