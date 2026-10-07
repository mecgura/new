import "server-only";
import { AppError } from "@/lib/errors";
import { otpConfigured } from "@/lib/integrations/otp";
import type { PatientContext } from "@/lib/portal/ctx";
import { todayIn, utcToZoned } from "@/lib/scheduling/time";
import { rateLimit } from "@/lib/security/rate-limit";
import { parseOrThrow } from "@/lib/validation";
import { consentSchema, correctionSchema, deactivationSchema, prefsSchema, profileUpdateSchema } from "@/lib/validation/portal";
import { nextCounter, type Client } from "./clinic-shared";
import { AUDIT_ACTIONS, clinicContact, iso, loadPortalSettings, paudit, pdb } from "./portal-core";
import { RELEASED_REPORT } from "./portal-records";

const pad = (n: number) => String(n).padStart(6, "0");
const parse = <T,>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

/* -------------------------------------------------- profile -------------------------------------------------- */
const FIELD_LABEL: Record<string, string> = { preferredName: "Preferred name", email: "Email", alternatePhone: "Alternate mobile", addressLine: "Address", city: "City", state: "State", country: "Country", pincode: "Pincode", emergencyContactName: "Emergency contact", emergencyContactRelation: "Emergency contact relation", emergencyContactPhone: "Emergency contact mobile" };
export async function getProfile(ctx: PatientContext) {
  const tdb = pdb(ctx); const settings = await loadPortalSettings(tdb, ctx.tenantId);
  const p = await tdb.patient.findFirst({ where: { id: ctx.patientId } });
  const allergies = await tdb.patientAllergy.findMany({ where: { patientId: ctx.patientId, status: "ACTIVE" }, orderBy: { recordedAt: "desc" }, take: 30, select: { allergen: true, reaction: true, severity: true } });
  return {
    patientCode: p.code as string, name: p.name as string, preferredName: (p.preferredName ?? null) as string | null, dateOfBirth: p.dateOfBirth ? (p.dateOfBirth as Date).toISOString().slice(0, 10) : null, gender: (p.gender ?? null) as string | null, bloodGroup: (p.bloodGroup ?? null) as string | null,
    phone: (p.phone ?? null) as string | null, alternatePhone: (p.alternatePhone ?? null) as string | null, email: (p.email ?? null) as string | null, addressLine: (p.addressLine ?? null) as string | null, city: (p.city ?? null) as string | null, state: (p.state ?? null) as string | null, country: (p.country ?? null) as string | null, pincode: (p.pincode ?? null) as string | null,
    emergencyContactName: (p.emergencyContactName ?? null) as string | null, emergencyContactRelation: (p.emergencyContactRelation ?? null) as string | null, emergencyContactPhone: (p.emergencyContactPhone ?? null) as string | null,
    editable: settings.editableFields.filter((f) => f in FIELD_LABEL), fieldLabels: FIELD_LABEL,
    // read-only medical information the clinician recorded (the patient can request a correction, never edit it)
    allergies: (allergies as { allergen: string; reaction: string | null; severity: string | null }[]).map((a) => ({ allergen: a.allergen, reaction: a.reaction, severity: a.severity })),
    clinic: clinicContact(ctx),
  };
}
/** Only fields the clinic allows the patient to edit; everything else needs a correction request. */
export async function updateProfile(ctx: PatientContext, raw: unknown) {
  const tdb = pdb(ctx); const settings = await loadPortalSettings(tdb, ctx.tenantId);
  const input = parseOrThrow(profileUpdateSchema, raw) as Record<string, string | undefined>;
  const data: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined && !(k in (raw as object))) continue;
    if (!settings.editableFields.includes(k)) throw new AppError("FORBIDDEN", { message: "You can't change that detail directly. Use \"Request a correction\" instead.", fieldErrors: { [k]: "Ask the clinic to change this." } });
    data[k] = v && v.length ? v : null;
  }
  const bad = Object.keys(raw as object).filter((k) => !(k in profileUpdateSchema.shape));
  if (bad.length) throw new AppError("FORBIDDEN", { message: "You can't change that detail directly. Use \"Request a correction\" instead." });
  if (!Object.keys(data).length) return { updated: [] as string[] };
  await tdb.patient.update({ where: { id: ctx.patientId }, data });
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_PROFILE_UPDATED, "patient", ctx.patientId, { fields: Object.keys(data) });
  return { updated: Object.keys(data) };
}

/* -------------------------------------------------- requests (corrections, support, deactivation) -------------------------------------------------- */
export async function createRequest(ctx: PatientContext, raw: unknown) {
  const v = parseOrThrow(correctionSchema, raw); const tdb = pdb(ctx);
  const lim = await rateLimit(`portal:req:${ctx.user.id}`, { limit: 10, windowMs: 60 * 60_000 }); if (!lim.allowed) throw new AppError("RATE_LIMITED");
  const open = await tdb.patientRequest.count({ where: { patientId: ctx.patientId, status: { in: ["PENDING", "UNDER_REVIEW"] } } });
  if (open >= 10) throw new AppError("CONFLICT", { message: "You have several requests waiting for the clinic. Please wait for them to be reviewed." });
  let current: string | null = null;
  if (v.kind === "PROFILE_CORRECTION" && v.field) { const p = await tdb.patient.findFirst({ where: { id: ctx.patientId } }); const cur = p?.[v.field]; current = cur instanceof Date ? cur.toISOString().slice(0, 10) : cur ? String(cur) : null; }
  const yr = todayIn(ctx.tenant.timezone).slice(0, 4);
  const row = await tdb.$transaction(async (tx: Client) => { const n = await nextCounter(tx, ctx.tenantId, `prq:${yr}`); return tx.patientRequest.create({ data: { tenantId: ctx.tenantId, requestNumber: `PRQ-${yr}-${pad(n)}`, patientId: ctx.patientId, kind: v.kind, field: v.field ?? null, currentValue: current, requestedValue: v.requestedValue ?? null, reason: v.reason }, select: { id: true, requestNumber: true } }); });
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_REQUEST_CREATED, "patient_request", row.id, { number: row.requestNumber, kind: v.kind, field: v.field ?? null });
  return { id: row.id as string, requestNumber: row.requestNumber as string };
}
export async function requestDeactivation(ctx: PatientContext, raw: unknown) {
  const v = parseOrThrow(deactivationSchema, raw); const tdb = pdb(ctx);
  const open = await tdb.patientRequest.findFirst({ where: { patientId: ctx.patientId, kind: "ACCOUNT_DEACTIVATION", status: { in: ["PENDING", "UNDER_REVIEW"] } }, select: { id: true } });
  if (open) throw new AppError("CONFLICT", { message: "You already asked for your portal account to be deactivated. The clinic will get back to you." });
  const yr = todayIn(ctx.tenant.timezone).slice(0, 4);
  const row = await tdb.$transaction(async (tx: Client) => { const n = await nextCounter(tx, ctx.tenantId, `prq:${yr}`); return tx.patientRequest.create({ data: { tenantId: ctx.tenantId, requestNumber: `PRQ-${yr}-${pad(n)}`, patientId: ctx.patientId, kind: "ACCOUNT_DEACTIVATION", reason: v.reason }, select: { id: true, requestNumber: true } }); });
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_REQUEST_CREATED, "patient_request", row.id, { number: row.requestNumber, kind: "ACCOUNT_DEACTIVATION" });
  return { id: row.id as string, requestNumber: row.requestNumber as string, note: "Your medical records are kept by the clinic as the law requires. Deactivating only closes your portal login." };
}
export async function listMyRequests(ctx: PatientContext) {
  const rows = await pdb(ctx).patientRequest.findMany({ where: { patientId: ctx.patientId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, requestNumber: true, kind: true, field: true, requestedValue: true, reason: true, status: true, reviewNote: true, createdAt: true, reviewedAt: true } });
  return { rows: rows.map((r: Record<string, any>) => ({ id: r.id as string, requestNumber: r.requestNumber as string, kind: r.kind as string, field: (r.field ?? null) as string | null, requestedValue: (r.requestedValue ?? null) as string | null, reason: r.reason as string, status: r.status as string, reviewNote: (r.reviewNote ?? null) as string | null, createdAt: iso(r.createdAt) as string, reviewedAt: iso(r.reviewedAt) })) };
}
export async function cancelMyRequest(ctx: PatientContext, id: string) {
  const r = await pdb(ctx).patientRequest.updateMany({ where: { id, patientId: ctx.patientId, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (r.count !== 1) throw new AppError("NOT_FOUND", { message: "That request can't be cancelled." });
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_REQUEST_CREATED, "patient_request", id, { action: "cancelled" });
  return { status: "CANCELLED" };
}

/* -------------------------------------------------- communication preferences -------------------------------------------------- */
const DEFAULT_CATEGORIES = { appointments: true, followUps: true, billing: true, reports: true, general: true };
/** Preferences only. No external channel is configured, so only "In-app" is active; the others record the patient's choice for later and are labelled as not yet in use. */
export async function getPreferences(ctx: PatientContext) {
  const tdb = pdb(ctx); const [acc, p] = await Promise.all([tdb.patientAccount.findFirst({ where: { id: ctx.accountId }, select: { prefs: true } }), tdb.patient.findFirst({ where: { id: ctx.patientId }, select: { prefEmail: true, prefSms: true, prefWhatsapp: true, prefPhone: true } })]);
  const ch = (v: string) => (v === "NOT_ALLOWED" ? "NOT_ALLOWED" : v === "ALLOWED" ? "ALLOWED" : "UNKNOWN");
  return { categories: { ...DEFAULT_CATEGORIES, ...parse<Record<string, boolean>>(acc?.prefs, {}) }, channels: { email: ch(p.prefEmail), sms: ch(p.prefSms), whatsapp: ch(p.prefWhatsapp), phone: ch(p.prefPhone) }, inApp: { available: true }, configured: { email: false, sms: false, whatsapp: false, otp: otpConfigured() }, note: "The clinic doesn't send email, SMS or WhatsApp messages from this system yet. Your choices are saved for when it does." };
}
export async function savePreferences(ctx: PatientContext, raw: unknown) {
  const v = parseOrThrow(prefsSchema, raw); const tdb = pdb(ctx);
  if (v.categories) { const acc = await tdb.patientAccount.findFirst({ where: { id: ctx.accountId }, select: { prefs: true } }); await tdb.patientAccount.update({ where: { id: ctx.accountId }, data: { prefs: JSON.stringify({ ...parse<Record<string, boolean>>(acc?.prefs, {}), ...v.categories }) } }); }
  if (v.channels) { const d: Record<string, string> = {}; if (v.channels.email) d.prefEmail = v.channels.email; if (v.channels.sms) d.prefSms = v.channels.sms; if (v.channels.whatsapp) d.prefWhatsapp = v.channels.whatsapp; if (v.channels.phone) d.prefPhone = v.channels.phone; if (Object.keys(d).length) await tdb.patient.update({ where: { id: ctx.patientId }, data: d }); }
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_PREFERENCES_CHANGED, "patient_account", ctx.accountId, { categories: Object.keys(v.categories ?? {}), channels: Object.keys(v.channels ?? {}) });
  return getPreferences(ctx);
}

/* -------------------------------------------------- privacy & consent -------------------------------------------------- */
const CONSENT_TEXT: Record<string, { title: string; text: string }> = {
  PRIVACY: { title: "Privacy notice", text: "The clinic keeps your health records to look after you. Only you and the clinic staff who treat you can see them." },
  COMMUNICATION: { title: "Clinic communication", text: "Allow the clinic to contact you about appointments, reports and follow-ups through the channels you choose." },
  DATA_PROCESSING: { title: "Use of my information", text: "Allow the clinic to use your information for running the clinic (scheduling, billing, reminders)." },
};
export async function getConsents(ctx: PatientContext) {
  const tdb = pdb(ctx); const settings = await loadPortalSettings(tdb, ctx.tenantId);
  const rows = (await tdb.patientConsent.findMany({ where: { patientId: ctx.patientId }, orderBy: { recordedAt: "desc" }, take: 60, select: { type: true, status: true, version: true, recordedAt: true } })) as { type: string; status: string; version: string; recordedAt: Date }[];
  return { version: settings.consentVersion, privacyNotice: settings.privacyNotice, consents: Object.entries(CONSENT_TEXT).map(([type, t]) => { const last = rows.find((r) => r.type === type); return { type, title: t.title, text: t.text, granted: last?.status === "GRANTED", status: last?.status ?? "NOT_RECORDED", version: last?.version ?? null, at: iso(last?.recordedAt) }; }), history: rows.slice(0, 15).map((r) => ({ type: r.type, status: r.status, version: r.version, at: r.recordedAt.toISOString() })) };
}
export async function setConsent(ctx: PatientContext, raw: unknown) {
  const v = parseOrThrow(consentSchema, raw); const tdb = pdb(ctx); const settings = await loadPortalSettings(tdb, ctx.tenantId);
  await tdb.patientConsent.create({ data: { tenantId: ctx.tenantId, patientId: ctx.patientId, type: v.type, status: v.granted ? "GRANTED" : "WITHDRAWN", version: settings.consentVersion, note: "Changed in the patient portal", recordedById: ctx.user.id } });
  await paudit(ctx, AUDIT_ACTIONS.PORTAL_CONSENT_CHANGED, "patient", ctx.patientId, { type: v.type, granted: v.granted, version: settings.consentVersion }); // no IP / device data is collected
  return getConsents(ctx);
}

/* -------------------------------------------------- support -------------------------------------------------- */
export async function helpInfo(ctx: PatientContext) {
  const s = await loadPortalSettings(pdb(ctx), ctx.tenantId);
  return { clinic: clinicContact(ctx), note: s.supportNote };
}

/* -------------------------------------------------- notifications (in-app) -------------------------------------------------- */
const WINDOW_DAYS = 21;
/**
 * Creates the patient's in-app notifications lazily from real records (like the staff reminders), deduplicated by a key so the same event never
 * appears twice. Respects the patient's category choices. Nothing is sent outside the portal.
 */
export async function syncNotifications(ctx: PatientContext) {
  const tdb = pdb(ctx); const tz = ctx.tenant.timezone; const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000); const today = todayIn(tz);
  const acc = await tdb.patientAccount.findFirst({ where: { id: ctx.accountId }, select: { prefs: true } }); const prefs = { ...DEFAULT_CATEGORIES, ...parse<Record<string, boolean>>(acc?.prefs, {}) };
  const out: { dedupeKey: string; type: string; title: string; body: string | null; entityType: string; entityId: string; createdAt: Date }[] = [];
  if (prefs.appointments) {
    const a = await tdb.appointment.findMany({ where: { patientId: ctx.patientId, updatedAt: { gte: since } }, select: { id: true, publicId: true, status: true, startsAt: true, updatedAt: true, confirmedAt: true } });
    for (const x of a as Record<string, any>[]) {
      const when = `${utcToZoned(x.startsAt, tz).date}`; const kind = x.status === "CONFIRMED" ? ["appointment_confirmed", "Appointment confirmed"] : x.status === "CANCELLED" ? ["appointment_cancelled", "Appointment cancelled"] : x.status === "REQUESTED" ? ["appointment_requested", "Appointment request received"] : null;
      if (kind) out.push({ dedupeKey: `${kind[0]}:${x.id}:${x.startsAt.getTime()}`, type: kind[0], title: kind[1], body: `${when}`, entityType: "appointment", entityId: x.publicId, createdAt: x.updatedAt });
    }
  }
  if (prefs.reports) {
    const r = await tdb.labReport.findMany({ where: { patientId: ctx.patientId, ...RELEASED_REPORT, releasedAt: { gte: since } }, select: { id: true, reportNumber: true, releasedAt: true, currentVersion: true } });
    for (const x of r as Record<string, any>[]) out.push({ dedupeKey: `report:${x.id}:${x.currentVersion}`, type: "report_released", title: "Your lab report is ready", body: x.reportNumber, entityType: "report", entityId: x.id, createdAt: x.releasedAt });
  }
  if (prefs.general) {
    const rx = await tdb.prescription.findMany({ where: { patientId: ctx.patientId, currentVersion: { gt: 0 }, finalizedAt: { gte: since } }, select: { id: true, number: true, currentVersion: true, finalizedAt: true } });
    for (const x of rx as Record<string, any>[]) out.push({ dedupeKey: `rx:${x.id}:${x.currentVersion}`, type: "prescription_available", title: "Your prescription is available", body: x.number, entityType: "prescription", entityId: x.id, createdAt: x.finalizedAt });
  }
  if (prefs.billing) {
    const [inv, pay] = await Promise.all([tdb.invoice.findMany({ where: { patientId: ctx.patientId, status: { not: "DRAFT" }, issuedAt: { gte: since } }, select: { id: true, invoiceNumber: true, issuedAt: true } }), tdb.payment.findMany({ where: { patientId: ctx.patientId, status: { in: ["SUCCESS", "PARTIALLY_REFUNDED", "REFUNDED"] }, createdAt: { gte: since } }, select: { id: true, receiptNumber: true, createdAt: true } })]);
    for (const x of inv as Record<string, any>[]) out.push({ dedupeKey: `invoice:${x.id}`, type: "invoice_issued", title: "A new bill was issued", body: x.invoiceNumber, entityType: "invoice", entityId: x.id, createdAt: x.issuedAt });
    for (const x of pay as Record<string, any>[]) out.push({ dedupeKey: `payment:${x.id}`, type: "payment_received", title: "Payment received", body: x.receiptNumber, entityType: "payment", entityId: x.id, createdAt: x.createdAt });
  }
  if (prefs.followUps) {
    const f = await tdb.followUp.findMany({ where: { patientId: ctx.patientId, status: { in: ["PENDING", "DUE", "IN_PROGRESS", "CONTACTED"] }, dueDate: { lte: today } }, select: { id: true, title: true, dueDate: true } });
    for (const x of f as Record<string, any>[]) out.push({ dedupeKey: `followup:${x.id}`, type: "followup_due", title: "A follow-up visit is due", body: x.title, entityType: "followup", entityId: x.id, createdAt: new Date() });
  }
  if (!out.length) return;
  const have = new Set(((await tdb.notification.findMany({ where: { userId: ctx.user.id, dedupeKey: { in: out.map((o) => o.dedupeKey) } }, select: { dedupeKey: true } })) as { dedupeKey: string }[]).map((n) => n.dedupeKey));
  for (const o of out.filter((x) => !have.has(x.dedupeKey))) { try { await tdb.notification.create({ data: { tenantId: ctx.tenantId, userId: ctx.user.id, ...o } }); } catch { /* a concurrent sync created it first — the unique key keeps it single */ } }
}
const HREF: Record<string, (id: string) => string> = { appointment: (id) => `/portal/appointments/${id}`, report: (id) => `/portal/reports/${id}`, prescription: (id) => `/portal/prescriptions/${id}`, invoice: (id) => `/portal/billing/invoices/${id}`, payment: () => "/portal/billing?view=payments", followup: () => "/portal/follow-ups" };
export async function listNotifications(ctx: PatientContext) {
  await syncNotifications(ctx).catch(() => undefined);
  const tdb = pdb(ctx); const [rows, unread] = await Promise.all([tdb.notification.findMany({ where: { userId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, type: true, title: true, body: true, entityType: true, entityId: true, readAt: true, createdAt: true } }), tdb.notification.count({ where: { userId: ctx.user.id, readAt: null } })]);
  return { unread: unread as number, items: rows.map((n: Record<string, any>) => ({ id: n.id as string, title: n.title as string, body: (n.body ?? null) as string | null, read: !!n.readAt, createdAt: iso(n.createdAt) as string, href: n.entityType && n.entityId && HREF[n.entityType] ? HREF[n.entityType](n.entityId) : null })) };
}
export async function markNotificationsRead(ctx: PatientContext, id?: string) {
  await pdb(ctx).notification.updateMany({ where: { userId: ctx.user.id, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
  return { ok: true };
}
