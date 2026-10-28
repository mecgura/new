import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma, type ClientAgreement } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { getSetting, setSetting } from "@/lib/settings";
import { sendMail, isEmailConfigured } from "@/lib/mailer";
import { siteConfig } from "@/config/site";
import { SERVICES } from "@/lib/catalog";
import type { SessionUser } from "@/lib/session";
import { normalizePhone, recordConsent } from "@/services/inbox/contacts";
import { SystemSendError, sendTemplateToContact } from "@/services/inbox/messaging";
import { createTemplate, submitTemplate } from "@/services/templates/templates";
import { waBotAccountId } from "@/services/site/lead-chat";
import { getMetaBilling } from "@/services/billing/meta-billing";
import { agreementSections, agreementText, sha256, type AgreementDetails, type Provider } from "@/services/agreements/terms";

/**
 * Client onboarding agreements. MECGURA creates one per client (prefilled from the client record), sends the link on
 * WhatsApp and email, and the client checks their details, uploads business proof and accepts it online. Details can
 * be corrected any time before signing; after signing a correction makes a new version that the client accepts again.
 */

// ---------------------------------------------------------------------------
// MECGURA's own details (shown as the provider in every agreement)
// ---------------------------------------------------------------------------
const PROVIDER_KEY = "agreement:provider";
export const TEMPLATE_NAME = "mecgura_client_agreement";
export const TEMPLATE_BODY =
  "Hi {{1}}, welcome to MECGURA!\n\nYour service agreement for {{2}} is ready. Please check your details, upload your business proof (GST / Udyam / PAN) and accept it here:\n{{3}}\n\nIf any detail is wrong, you can correct it on the same page.\n\nThank you,\nTeam MECGURA";

export const providerSchema = z.object({
  legalName: z.string().trim().max(150).default("MECGURA"),
  address: z.string().trim().max(400).default(""),
  gstin: z.string().trim().toUpperCase().max(15).default(""),
  email: z.string().trim().max(200).default(""),
  phone: z.string().trim().max(20).default(""),
  signatoryName: z.string().trim().max(100).default(""),
  signatoryTitle: z.string().trim().max(100).default("Founder"),
  jurisdiction: z.string().trim().max(100).default(""),
  /** WhatsApp number the agreement link is sent from (defaults to the website assistant number). */
  sendFromAccountId: z.string().trim().max(64).default(""),
});
export type ProviderSettings = z.infer<typeof providerSchema>;

export async function getProvider(): Promise<ProviderSettings> {
  try {
    return providerSchema.parse(JSON.parse(await getSetting(PROVIDER_KEY, "{}")));
  } catch {
    return providerSchema.parse({});
  }
}

export async function saveProvider(input: ProviderSettings, actorUserId: string, req?: Request) {
  if (input.sendFromAccountId && !(await db.whatsAppAccount.count({ where: { id: input.sendFromAccountId } }))) throw new ApiError("NOT_FOUND", "WhatsApp number not found.");
  await setSetting(PROVIDER_KEY, JSON.stringify(input));
  await audit({ action: "site.content_updated", actorUserId, targetType: "agreement_settings", metadata: { fields: Object.keys(input) }, req });
  return input;
}

const providerFor = (p: ProviderSettings): Provider => ({ ...p, email: p.email || siteConfig.contact.email, phone: p.phone || `+${siteConfig.contact.whatsapp}` });

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const optional = (max: number) => z.string().trim().max(max);

/** Fields the client can correct on their page. */
export const clientDetailsSchema = z.object({
  businessName: z.string().trim().min(2, "Enter the business name").max(150),
  businessType: optional(80).default(""),
  contactName: z.string().trim().min(2, "Enter the contact person's name").max(100),
  designation: optional(80).default(""),
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => Boolean(normalizePhone(v)), "Enter a valid mobile number")
    .transform((v) => normalizePhone(v)!),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  address: optional(300).default(""),
  city: optional(80).default(""),
  state: optional(80).default(""),
  pincode: z.string().trim().refine((v) => v === "" || /^\d{6}$/.test(v), "Enter a 6-digit PIN code").default(""),
  gstin: z.string().trim().toUpperCase().refine((v) => v === "" || GSTIN.test(v), "Enter a valid 15-character GSTIN").default(""),
  pan: z.string().trim().toUpperCase().refine((v) => v === "" || PAN.test(v), "Enter a valid PAN (e.g. ABCDE1234F)").default(""),
});

/** Admin can also change the commercial terms. */
export const adminDetailsSchema = clientDetailsSchema.extend({
  planName: optional(80).default(""),
  priceRupees: z.coerce.number().min(0).max(10_000_000).default(0),
  setupFeeRupees: z.coerce.number().min(0).max(10_000_000).default(0),
  services: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  billingMode: z.enum(["client_pays", "prepaid_wallet", "package"]).default("client_pays"),
  startDate: z.string().trim().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Pick a date").default(""),
  termMonths: z.coerce.number().int().min(1).max(60).default(12),
  extraTerms: optional(4000).default(""),
  /** Also correct the client record (name, phone, email) with these details. */
  syncClient: z.boolean().default(true),
});

export const signSchema = z.object({
  signerName: z.string().trim().min(2, "Type your full name").max(100),
  designation: optional(80).default(""),
  accept: z.literal(true, { message: "Tick the box to accept the agreement" }),
});

export const DOC_KINDS = ["gst", "udyam", "pan", "shop_licence", "incorporation", "id_proof", "other"] as const;
export const DOC_LABELS: Record<(typeof DOC_KINDS)[number], string> = {
  gst: "GST certificate",
  udyam: "Udyam / MSME certificate",
  pan: "Business PAN card",
  shop_licence: "Shop & Establishment licence",
  incorporation: "Incorporation / partnership deed",
  id_proof: "Owner ID proof (Aadhaar / PAN)",
  other: "Other document",
};
export const MAX_DOC_BYTES = 4 * 1024 * 1024;
const MAX_DOCS = 12;
const DOC_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const rupeesToPaise = (r: number) => Math.round(r * 100);
const parseList = (s: string): string[] => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
export const agreementLink = (token: string) => `${siteConfig.url}/agreement/${token}`;

function details(a: ClientAgreement): AgreementDetails {
  return { ...a, services: parseList(a.services) };
}

async function nextNumber() {
  const year = new Date().getUTCFullYear();
  const count = await db.clientAgreement.count({ where: { number: { startsWith: `MGC-AGR-${year}-` } } });
  return `MGC-AGR-${year}-${String(count + 1).padStart(4, "0")}`;
}

async function insertAgreement(data: Omit<Prisma.ClientAgreementUncheckedCreateInput, "number" | "token">) {
  for (let i = 0; i < 5; i++) {
    try {
      return await db.clientAgreement.create({ data: { ...data, number: await nextNumber(), token: randomBytes(24).toString("base64url") } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") || i === 4) throw e;
    }
  }
  throw new ApiError("CONFLICT", "Could not number the agreement. Try again.");
}

export type AgreementView = ReturnType<typeof toView>;
function toView(a: ClientAgreement & { documents?: { id: string; kind: string; fileName: string; mimeType: string; sizeBytes: number; status: string; note: string; uploadedBy: string; createdAt: Date }[] }, p: ProviderSettings) {
  const d = details(a);
  return {
    id: a.id,
    organizationId: a.organizationId,
    number: a.number,
    version: a.version,
    status: a.status,
    link: agreementLink(a.token),
    manualWhatsApp: a.phone ? manualWhatsAppLink(a) : "",
    details: d,
    sections: a.status === "signed" && a.signedText ? null : agreementSections(d, providerFor(p)),
    signedText: a.signedText,
    provider: providerFor(p),
    sentAt: a.sentAt,
    sendLog: (() => {
      try {
        return JSON.parse(a.sendLog) as SendLog;
      } catch {
        return {} as SendLog;
      }
    })(),
    viewedAt: a.viewedAt,
    signedAt: a.signedAt,
    signerName: a.signerName,
    signerIp: a.signerIp,
    signedHash: a.signedHash,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    documents: (a.documents ?? []).map((x) => ({ ...x, label: DOC_LABELS[x.kind as keyof typeof DOC_LABELS] ?? "Document" })),
  };
}

const withDocs = { documents: { orderBy: { createdAt: "asc" as const }, select: { id: true, kind: true, fileName: true, mimeType: true, sizeBytes: true, status: true, note: true, uploadedBy: true, createdAt: true } } };

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

/** Starts an agreement for a client, prefilled from the client record, plan, services and billing type. */
export async function createAgreement(organizationId: string, actorUserId: string, req?: Request) {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      members: { where: { role: "CLIENT_OWNER" }, orderBy: { createdAt: "asc" }, take: 1, include: { user: { select: { name: true, email: true } } } },
      subscriptions: { where: { status: "active" }, take: 1, include: { plan: { select: { name: true } } } },
      services: { where: { enabled: true }, select: { service: true } },
    },
  });
  if (!org) throw new ApiError("NOT_FOUND", "Client not found.");
  const open = await db.clientAgreement.findFirst({ where: { organizationId, status: { in: ["draft", "sent"] } }, orderBy: { createdAt: "desc" } });
  if (open) return open;
  const last = await db.clientAgreement.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" } });
  const owner = org.members[0]?.user;
  const sub = org.subscriptions[0];
  const labels = SERVICES.filter((s) => org.services.some((x) => x.service === s.key)).map((s) => s.label);
  const a = await insertAgreement({
    organizationId,
    version: 1,
    businessName: last?.businessName || org.name,
    contactName: last?.contactName || owner?.name || "",
    phone: normalizePhone(org.contactPhone) ?? last?.phone ?? "",
    email: org.contactEmail || owner?.email || last?.email || "",
    businessType: last?.businessType ?? "",
    designation: last?.designation ?? "",
    address: last?.address ?? "",
    city: last?.city ?? "",
    state: last?.state ?? "",
    pincode: last?.pincode ?? "",
    gstin: last?.gstin ?? "",
    pan: last?.pan ?? "",
    planName: sub?.plan.name ?? "",
    pricePaise: sub?.priceMonthly ?? 0,
    services: JSON.stringify(labels),
    billingMode: (await getMetaBilling(organizationId)).mode,
    startDate: new Date().toISOString().slice(0, 10),
    createdById: actorUserId,
  });
  await audit({ action: "agreement.created", actorUserId, organizationId, targetType: "agreement", targetId: a.id, metadata: { number: a.number }, req });
  return a;
}

export async function listAgreements(organizationId: string) {
  const p = await getProvider();
  const rows = await db.clientAgreement.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, include: withDocs });
  return rows.map((r) => toView(r, p));
}

export async function allAgreements(q: { status?: string; page: number; pageSize: number }) {
  const where = q.status ? { status: q.status } : {};
  const [rows, total] = await Promise.all([
    db.clientAgreement.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: { id: true, organizationId: true, number: true, version: true, status: true, businessName: true, contactName: true, phone: true, sentAt: true, viewedAt: true, signedAt: true, updatedAt: true, _count: { select: { documents: true } }, organization: { select: { name: true } } },
    }),
    db.clientAgreement.count({ where }),
  ]);
  return { items: rows.map((r) => ({ ...r, clientName: r.organization.name, documents: r._count.documents })), total, page: q.page, pageSize: q.pageSize };
}

export async function getAgreement(id: string) {
  const a = await db.clientAgreement.findUnique({ where: { id }, include: withDocs });
  if (!a) throw new ApiError("NOT_FOUND", "Agreement not found.");
  return toView(a, await getProvider());
}

/**
 * Corrects an agreement. Before signing it is edited in place (and the client sees the change on their link). A signed
 * agreement is never changed: the correction becomes a new version for the client to accept, and the old one is kept.
 */
export async function updateAgreement(id: string, input: z.infer<typeof adminDetailsSchema>, actorUserId: string, req?: Request) {
  const a = await db.clientAgreement.findUnique({ where: { id } });
  if (!a) throw new ApiError("NOT_FOUND", "Agreement not found.");
  if (a.status === "void" || a.status === "superseded") throw new ApiError("CONFLICT", "This agreement is closed. Open the latest version.");
  const { syncClient, priceRupees, setupFeeRupees, services, ...rest } = input;
  const data = { ...rest, pricePaise: rupeesToPaise(priceRupees), setupFeePaise: rupeesToPaise(setupFeeRupees), services: JSON.stringify(services) };
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => String(data[k]) !== String(a[k]));
  let result: ClientAgreement;
  if (a.status === "signed") {
    if (!changed.length) return getAgreement(a.id);
    await db.clientAgreement.update({ where: { id: a.id }, data: { status: "superseded" } });
    result = await insertAgreement({ organizationId: a.organizationId, version: a.version + 1, ...data, createdById: actorUserId });
    await db.clientDocument.updateMany({ where: { agreementId: a.id }, data: { agreementId: result.id } });
  } else {
    result = await db.clientAgreement.update({ where: { id }, data });
  }
  if (syncClient) {
    const org = await db.organization.findUnique({ where: { id: a.organizationId }, select: { name: true, contactPhone: true, contactEmail: true } });
    const patch = {
      ...(org && org.name !== data.businessName ? { name: data.businessName } : {}),
      ...(org && org.contactPhone !== data.phone ? { contactPhone: data.phone } : {}),
      ...(org && org.contactEmail !== data.email ? { contactEmail: data.email } : {}),
    };
    if (Object.keys(patch).length) {
      await db.organization.update({ where: { id: a.organizationId }, data: patch });
      await audit({ action: "client.updated", actorUserId, organizationId: a.organizationId, targetType: "organization", targetId: a.organizationId, metadata: { fields: Object.keys(patch), via: "agreement" }, req });
    }
  }
  await audit({ action: "agreement.updated", actorUserId, organizationId: a.organizationId, targetType: "agreement", targetId: result.id, metadata: { number: result.number, version: result.version, fields: changed }, req });
  return getAgreement(result.id);
}

export async function voidAgreement(id: string, actorUserId: string, req?: Request) {
  const a = await db.clientAgreement.findUnique({ where: { id } });
  if (!a) throw new ApiError("NOT_FOUND", "Agreement not found.");
  if (a.status === "void") return getAgreement(id);
  await db.clientAgreement.update({ where: { id }, data: { status: "void" } });
  await audit({ action: "agreement.voided", actorUserId, organizationId: a.organizationId, targetType: "agreement", targetId: id, metadata: { number: a.number }, req });
  return getAgreement(id);
}

// ---------------------------------------------------------------------------
// Sending (WhatsApp template + email)
// ---------------------------------------------------------------------------
export type ChannelResult = { sent: boolean; message: string };
export type SendLog = { whatsapp?: ChannelResult & { at: string }; email?: ChannelResult & { at: string }; manualWhatsApp?: string };

const firstName = (n: string) => n.trim().split(/\s+/)[0] || "there";

/** wa.me link with the message typed in, so the link can always be sent by hand from a phone. */
export function manualWhatsAppLink(a: Pick<ClientAgreement, "phone" | "contactName" | "businessName" | "token">) {
  const text = TEMPLATE_BODY.replace("{{1}}", firstName(a.contactName)).replace("{{2}}", a.businessName).replace("{{3}}", agreementLink(a.token));
  return `https://wa.me/${a.phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

async function sendingAccount() {
  const p = await getProvider();
  const id = p.sendFromAccountId || (await waBotAccountId());
  if (!id) return null;
  const a = await db.whatsAppAccount.findUnique({ where: { id }, select: { id: true, organizationId: true, wabaRecordId: true, status: true, displayName: true, phoneNumber: true } });
  return a?.wabaRecordId ? { ...a, wabaRecordId: a.wabaRecordId } : null;
}

export async function templateStatus() {
  const acct = await sendingAccount();
  if (!acct) return { account: null, template: null };
  const t = await db.messageTemplate.findFirst({ where: { organizationId: acct.organizationId, wabaRecordId: acct.wabaRecordId, name: TEMPLATE_NAME }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, rejectedReason: true } });
  return { account: { id: acct.id, label: `${acct.displayName} (${acct.phoneNumber})`, status: acct.status }, template: t };
}

/** Creates the agreement template on MECGURA's own WhatsApp number and sends it to Meta for approval. */
export async function ensureAgreementTemplate(admin: SessionUser, req?: Request) {
  const acct = await sendingAccount();
  if (!acct) throw new ApiError("VALIDATION_ERROR", "Choose the WhatsApp number to send from first (Admin → Agreements → Settings, or connect the website WhatsApp assistant number).");
  const access = { user: admin, organizationId: acct.organizationId, role: null, isPlatformAdmin: true };
  let t = await db.messageTemplate.findFirst({ where: { organizationId: acct.organizationId, wabaRecordId: acct.wabaRecordId, name: TEMPLATE_NAME, language: "en" } });
  if (!t) {
    const created = await createTemplate(
      access,
      {
        wabaId: acct.wabaRecordId,
        name: TEMPLATE_NAME,
        language: "en",
        category: "UTILITY",
        headerType: "none",
        headerText: "",
        body: TEMPLATE_BODY,
        footer: "",
        buttons: [],
        examples: { body: ["Ravi", "Sharma Traders", `${siteConfig.url}/agreement/AbC123xYz`] },
        authOptions: { addSecurityRecommendation: true, codeExpirationMinutes: 10, buttonText: "Copy code" },
      },
      req
    );
    t = await db.messageTemplate.findUniqueOrThrow({ where: { id: created.id } });
  }
  if (t.status === "draft") await submitTemplate(access, t.id, undefined, req);
  return templateStatus();
}

async function sendWhatsApp(a: ClientAgreement): Promise<ChannelResult> {
  if (!a.phone) return { sent: false, message: "No mobile number on the agreement." };
  const acct = await sendingAccount();
  if (!acct) return { sent: false, message: "No MECGURA WhatsApp number is set to send from." };
  const t = await db.messageTemplate.findFirst({ where: { organizationId: acct.organizationId, wabaRecordId: acct.wabaRecordId, name: TEMPLATE_NAME, status: "approved" }, select: { id: true } });
  if (!t) return { sent: false, message: "The agreement WhatsApp template is not approved by Meta yet. Use \"Send from my phone\" for now." };
  const orgId = acct.organizationId;
  let contact = await db.contact.findUnique({ where: { organizationId_phone: { organizationId: orgId, phone: a.phone } } });
  if (!contact) contact = await db.contact.create({ data: { organizationId: orgId, phone: a.phone, name: a.contactName, email: a.email, source: "manual", lifecycle: "customer" } });
  if (contact.optInStatus === "opted_out" || contact.suppressed) return { sent: false, message: "This number has opted out of WhatsApp messages from MECGURA." };
  if (contact.optInStatus !== "opted_in") {
    await recordConsent({ organizationId: orgId, actorUserId: null }, contact.id, { status: "opted_in", source: "manual", evidence: `Signed up as a MECGURA client (${a.businessName}); agreement ${a.number}` }, { silent: true });
  }
  try {
    await sendTemplateToContact(orgId, acct.id, contact.id, t.id, { "body.1": firstName(a.contactName), "body.2": a.businessName, "body.3": agreementLink(a.token) }, { origin: "agreement", agreementId: a.id });
    return { sent: true, message: `Sent to ${a.phone}` };
  } catch (e) {
    return { sent: false, message: e instanceof SystemSendError || e instanceof ApiError ? e.message : "WhatsApp sending failed." };
  }
}

async function sendEmail(a: ClientAgreement, kind: "invite" | "signed"): Promise<ChannelResult> {
  if (!a.email) return { sent: false, message: "No email on the agreement." };
  const link = agreementLink(a.token);
  const subject = kind === "invite" ? `MECGURA service agreement for ${a.businessName} (${a.number})` : `Signed: MECGURA service agreement ${a.number}`;
  const text =
    kind === "invite"
      ? [
          `Hi ${firstName(a.contactName)},`,
          "",
          `Welcome to MECGURA! Your service agreement for ${a.businessName} is ready.`,
          "",
          "Please open the link below to:",
          "1. Check your business details (correct anything that is wrong)",
          "2. Upload your business proof (GST certificate, Udyam or business PAN)",
          "3. Read and accept the agreement",
          "",
          link,
          "",
          `Questions? Reply to this email or WhatsApp us at +${siteConfig.contact.whatsapp}.`,
          "",
          "Thank you,",
          "Team MECGURA",
        ].join("\n")
      : [
          `Hi ${firstName(a.contactName)},`,
          "",
          `Thank you for accepting the MECGURA service agreement ${a.number} (version ${a.version}) on ${a.signedAt?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.`,
          "",
          `You can view or download your signed copy any time here: ${link}`,
          "",
          `Document fingerprint (SHA-256): ${a.signedHash}`,
          "",
          "Team MECGURA",
        ].join("\n");
  const r = await sendMail(a.email, subject, text);
  if (r.delivered) return { sent: true, message: r.channel === "dev-log" ? "Logged (development)" : `Sent to ${a.email}` };
  return { sent: false, message: isEmailConfigured() ? "The email service refused the message." : "Email is not set up (RESEND_API_KEY / EMAIL_FROM)." };
}

/** Sends (or re-sends) the agreement link. The status moves to "sent" even if a channel failed, so the link can be shared by hand. */
export async function sendAgreement(id: string, channels: { whatsapp: boolean; email: boolean }, actorUserId: string, req?: Request) {
  const a = await db.clientAgreement.findUnique({ where: { id } });
  if (!a) throw new ApiError("NOT_FOUND", "Agreement not found.");
  if (a.status !== "draft" && a.status !== "sent") throw new ApiError("CONFLICT", a.status === "signed" ? "This agreement is already signed." : "This agreement is closed.");
  if (!a.phone && !a.email) throw new ApiError("VALIDATION_ERROR", "Add the client's mobile number or email first.");
  const at = new Date().toISOString();
  const log: SendLog = { manualWhatsApp: a.phone ? manualWhatsAppLink(a) : "" };
  if (channels.whatsapp) log.whatsapp = { ...(await sendWhatsApp(a)), at };
  if (channels.email) log.email = { ...(await sendEmail(a, "invite")), at };
  await db.clientAgreement.update({ where: { id }, data: { status: "sent", sentAt: new Date(), sendLog: JSON.stringify(log) } });
  await audit({ action: "agreement.sent", actorUserId, organizationId: a.organizationId, targetType: "agreement", targetId: id, metadata: { number: a.number, whatsapp: log.whatsapp?.sent ?? null, email: log.email?.sent ?? null }, req });
  return { agreement: await getAgreement(id), log };
}

/** Onboarding shortcut: create the agreement and send it on both channels. Never throws (client creation must not fail). */
export async function onboardWithAgreement(organizationId: string, actorUserId: string, req?: Request) {
  try {
    const a = await createAgreement(organizationId, actorUserId, req);
    return (await sendAgreement(a.id, { whatsapp: true, email: true }, actorUserId, req)).log;
  } catch (e) {
    console.error("[agreements] onboarding send failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// The client's link (no login: the token is the key)
// ---------------------------------------------------------------------------
async function byToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new ApiError("NOT_FOUND", "This agreement link is not valid.");
  const a = await db.clientAgreement.findUnique({ where: { token }, include: withDocs });
  if (!a) throw new ApiError("NOT_FOUND", "This agreement link is not valid.");
  return a;
}

export type PublicAgreement = Awaited<ReturnType<typeof publicAgreement>>;

/** What the client sees. Marks the first view. A replaced agreement points to nothing (the client gets the new link). */
export async function publicAgreement(token: string, markViewed = true) {
  const a = await byToken(token);
  if (markViewed && !a.viewedAt && a.status === "sent") await db.clientAgreement.update({ where: { id: a.id }, data: { viewedAt: new Date() } });
  const v = toView(a, await getProvider());
  return {
    number: v.number,
    version: v.version,
    status: v.status,
    details: v.details,
    sections: v.sections,
    signedText: v.signedText,
    provider: v.provider,
    signedAt: v.signedAt,
    signerName: v.signerName,
    signedHash: v.signedHash,
    documents: v.documents.map(({ id, kind, label, fileName, mimeType, sizeBytes, status, note, createdAt }) => ({ id, kind, label, fileName, mimeType, sizeBytes, status, note, createdAt })),
  };
}

function assertOpen(a: ClientAgreement) {
  if (a.status === "signed") throw new ApiError("CONFLICT", "This agreement is already signed. Ask MECGURA to send a corrected version.");
  if (a.status !== "sent" && a.status !== "draft") throw new ApiError("CONFLICT", "This agreement is no longer active. Please use the latest link from MECGURA.");
}

async function adminIds() {
  return (await db.user.findMany({ where: { role: "SUPER_ADMIN", status: "active" }, select: { id: true } })).map((u) => u.id);
}

/** The client corrects their own details (name, mobile, GSTIN…) before signing. MECGURA is told what changed. */
export async function clientUpdateDetails(token: string, input: z.infer<typeof clientDetailsSchema>, req?: Request) {
  const a = await byToken(token);
  assertOpen(a);
  const changed = (Object.keys(input) as (keyof typeof input)[]).filter((k) => input[k] !== a[k]);
  if (!changed.length) return publicAgreement(token, false);
  await db.clientAgreement.update({ where: { id: a.id }, data: input });
  await audit({ action: "agreement.updated", organizationId: a.organizationId, targetType: "agreement", targetId: a.id, metadata: { number: a.number, fields: changed, by: "client" }, req });
  for (const userId of await adminIds()) {
    await notify({ userId, organizationId: a.organizationId, title: `${input.businessName} corrected their agreement details`, body: `Changed: ${changed.join(", ")}`, link: `/admin/clients/${a.organizationId}?tab=agreement` });
  }
  return publicAgreement(token, false);
}

function checkFile(file: { size: number; type: string; name: string }) {
  if (file.size === 0) throw new ApiError("VALIDATION_ERROR", "Choose a file.", { details: { file: ["Required"] } });
  if (file.size > MAX_DOC_BYTES) throw new ApiError("VALIDATION_ERROR", "Files can be up to 4 MB. Take a clearer, smaller photo or compress the PDF.", { details: { file: ["Too large"] } });
  if (!DOC_TYPES[file.type]) throw new ApiError("VALIDATION_ERROR", "Upload a PDF, JPG, PNG or WebP file.", { details: { file: ["Unsupported type"] } });
}

/** Checks the file really is what its type says (first bytes), so a renamed file can't slip through. */
function sniff(bytes: Uint8Array, type: string) {
  const b = bytes;
  const ok =
    (type === "application/pdf" && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) ||
    (type === "image/jpeg" && b[0] === 0xff && b[1] === 0xd8) ||
    (type === "image/png" && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ||
    (type === "image/webp" && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50);
  if (!ok) throw new ApiError("VALIDATION_ERROR", "This file looks damaged or is not the type it says. Upload a PDF, JPG, PNG or WebP.");
}

async function storeDocument(a: ClientAgreement, kind: string, file: File, by: "client" | "admin", actorUserId: string | null, req?: Request) {
  if (!(DOC_KINDS as readonly string[]).includes(kind)) throw new ApiError("VALIDATION_ERROR", "Choose the document type.", { details: { kind: ["Required"] } });
  checkFile(file);
  if ((await db.clientDocument.count({ where: { agreementId: a.id } })) >= MAX_DOCS) throw new ApiError("CONFLICT", `Up to ${MAX_DOCS} documents can be added. Remove one first.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  sniff(bytes, file.type);
  const name = (file.name || `document.${DOC_TYPES[file.type]}`).replace(/[^\w.\- ()]/g, "_").slice(0, 120);
  const doc = await db.clientDocument.create({ data: { organizationId: a.organizationId, agreementId: a.id, kind, fileName: name, mimeType: file.type, sizeBytes: file.size, data: bytes, uploadedBy: by } });
  await audit({ action: "document.uploaded", actorUserId, organizationId: a.organizationId, targetType: "client_document", targetId: doc.id, metadata: { kind, by, number: a.number }, req });
  if (by === "client") for (const userId of await adminIds()) await notify({ userId, organizationId: a.organizationId, title: `${a.businessName} uploaded ${DOC_LABELS[kind as keyof typeof DOC_LABELS]}`, link: `/admin/clients/${a.organizationId}?tab=agreement` });
  return doc.id;
}

export async function clientUploadDocument(token: string, kind: string, file: File, req?: Request) {
  const a = await byToken(token);
  assertOpen(a);
  await storeDocument(a, kind, file, "client", null, req);
  return publicAgreement(token, false);
}

/** The client removes a document they uploaded by mistake (only before signing, and only if MECGURA hasn't verified it). */
export async function clientDeleteDocument(token: string, docId: string, req?: Request) {
  const a = await byToken(token);
  assertOpen(a);
  const d = await db.clientDocument.findFirst({ where: { id: docId, agreementId: a.id } });
  if (!d) throw new ApiError("NOT_FOUND", "Document not found.");
  if (d.status === "verified") throw new ApiError("CONFLICT", "MECGURA already verified this document. Ask us if it needs to change.");
  await db.clientDocument.delete({ where: { id: d.id } });
  await audit({ action: "document.reviewed", organizationId: a.organizationId, targetType: "client_document", targetId: d.id, metadata: { action: "deleted", by: "client" }, req });
  return publicAgreement(token, false);
}

export async function clientDocumentFile(token: string, docId: string) {
  const a = await byToken(token);
  const d = await db.clientDocument.findFirst({ where: { id: docId, agreementId: a.id } });
  if (!d) throw new ApiError("NOT_FOUND", "Document not found.");
  return d;
}

/** Electronic acceptance: needs a business proof, a typed name and the consent tick. Freezes the text and its hash. */
export async function signAgreement(token: string, input: z.infer<typeof signSchema>, ip: string, userAgent: string, req?: Request) {
  const a = await byToken(token);
  assertOpen(a);
  if (a.status === "draft") throw new ApiError("CONFLICT", "MECGURA has not sent this agreement yet.");
  const parsed = clientDetailsSchema.safeParse(a);
  if (!parsed.success) throw new ApiError("VALIDATION_ERROR", "Please complete your business details first (name, contact person, mobile and email).");
  if (!a.documents.some((d) => d.status !== "rejected")) throw new ApiError("VALIDATION_ERROR", "Upload at least one business proof (GST certificate, Udyam or business PAN) before accepting.");
  const designation = input.designation || a.designation;
  const signedAt = new Date();
  const text = `${agreementText(details({ ...a, designation }), providerFor(await getProvider()))}\n\nACCEPTED ELECTRONICALLY by ${input.signerName}${designation ? `, ${designation}` : ""} for ${a.businessName} on ${signedAt.toISOString()} from IP ${ip || "unknown"}.`;
  const hash = sha256(text);
  const updated = await db.clientAgreement.updateMany({
    where: { id: a.id, status: "sent" },
    data: { status: "signed", signedAt, signerName: input.signerName, designation, signerIp: ip.slice(0, 64), signerAgent: userAgent.slice(0, 300), signedText: text, signedHash: hash },
  });
  if (!updated.count) throw new ApiError("CONFLICT", "This agreement was just changed. Reload the page and try again.");
  const signed = await db.clientAgreement.findUniqueOrThrow({ where: { id: a.id } });
  await audit({ action: "agreement.signed", organizationId: a.organizationId, targetType: "agreement", targetId: a.id, metadata: { number: a.number, version: a.version, signer: input.signerName, hash }, req });
  for (const userId of await adminIds()) {
    await notify({ userId, organizationId: a.organizationId, type: "success", title: `${a.businessName} signed agreement ${a.number}`, body: `Signed by ${input.signerName}`, link: `/admin/clients/${a.organizationId}?tab=agreement` });
  }
  const owners = await db.organizationMember.findMany({ where: { organizationId: a.organizationId, role: "CLIENT_OWNER" }, select: { userId: true } });
  for (const o of owners) await notify({ userId: o.userId, organizationId: a.organizationId, type: "success", title: "Service agreement accepted", body: `Agreement ${a.number} is signed. Thank you!`, link: "/dashboard" });
  await sendEmail(signed, "signed").catch(() => undefined);
  return publicAgreement(token, false);
}

// ---------------------------------------------------------------------------
// Admin: documents
// ---------------------------------------------------------------------------
export async function adminUploadDocument(agreementId: string, kind: string, file: File, actorUserId: string, req?: Request) {
  const a = await db.clientAgreement.findUnique({ where: { id: agreementId } });
  if (!a) throw new ApiError("NOT_FOUND", "Agreement not found.");
  await storeDocument(a, kind, file, "admin", actorUserId, req);
  return getAgreement(agreementId);
}

export async function adminDocumentFile(docId: string) {
  const d = await db.clientDocument.findUnique({ where: { id: docId } });
  if (!d) throw new ApiError("NOT_FOUND", "Document not found.");
  return d;
}

export const reviewSchema = z.object({ status: z.enum(["pending", "verified", "rejected"]), note: z.string().trim().max(300).default("") });

export async function reviewDocument(docId: string, input: z.infer<typeof reviewSchema>, actorUserId: string, req?: Request) {
  const d = await db.clientDocument.findUnique({ where: { id: docId }, select: { id: true, organizationId: true, agreementId: true, kind: true } });
  if (!d) throw new ApiError("NOT_FOUND", "Document not found.");
  await db.clientDocument.update({ where: { id: docId }, data: input });
  await audit({ action: "document.reviewed", actorUserId, organizationId: d.organizationId, targetType: "client_document", targetId: docId, metadata: { kind: d.kind, ...input }, req });
  return d.agreementId ? getAgreement(d.agreementId) : null;
}

export async function deleteDocument(docId: string, actorUserId: string, req?: Request) {
  const d = await db.clientDocument.findUnique({ where: { id: docId }, select: { id: true, organizationId: true, agreementId: true, kind: true } });
  if (!d) throw new ApiError("NOT_FOUND", "Document not found.");
  await db.clientDocument.delete({ where: { id: docId } });
  await audit({ action: "document.reviewed", actorUserId, organizationId: d.organizationId, targetType: "client_document", targetId: docId, metadata: { kind: d.kind, action: "deleted" }, req });
  return d.agreementId ? getAgreement(d.agreementId) : null;
}


/**
 * The agreement a client owner sees inside their own workspace (Agreement & KYC page). Logged in, so no link is
 * needed: if MECGURA hasn't created or sent one yet, it is created from the client's record and opened for signing.
 */
export async function workspaceAgreement(organizationId: string, actorUserId: string, req?: Request) {
  let a = await db.clientAgreement.findFirst({ where: { organizationId, status: { in: ["draft", "sent", "signed"] } }, orderBy: { createdAt: "desc" } });
  if (!a) a = await createAgreement(organizationId, actorUserId, req);
  if (a.status === "draft") {
    a = await db.clientAgreement.update({ where: { id: a.id }, data: { status: "sent", sentAt: new Date() } });
    await audit({ action: "agreement.sent", actorUserId, organizationId, targetType: "agreement", targetId: a.id, metadata: { number: a.number, via: "client_workspace" }, req });
  }
  return { token: a.token, agreement: await publicAgreement(a.token) };
}

/** Whether the workspace still has to sign its agreement or upload business proof (for the dashboard checklist). */
export async function agreementProgress(organizationId: string) {
  const a = await db.clientAgreement.findFirst({
    where: { organizationId, status: { in: ["draft", "sent", "signed"] } },
    orderBy: { createdAt: "desc" },
    select: { status: true, _count: { select: { documents: { where: { status: { not: "rejected" } } } } } },
  });
  return { signed: a?.status === "signed", hasProof: (a?._count.documents ?? 0) > 0 };
}
