import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost" }), cookies: async () => ({ get: () => undefined }) }));

import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays, todayIn, zonedToUtc } from "@/lib/scheduling/time";
import { asTenant, ctxFor, makeUser, seedSystemData, uniq } from "@/test/helpers";
import type { RoleKey } from "@/lib/permissions";
import { __setProvider } from "@/lib/communications/providers/registry";
import { __setProviderFetch } from "@/lib/communications/providers/http";
import { metaWhatsApp } from "@/lib/communications/providers/meta-whatsapp";
import { twilioSms } from "@/lib/communications/providers/twilio-sms";
import { resendEmail } from "@/lib/communications/providers/resend-email";
import { svixSignature, twilioSignature } from "@/lib/communications/providers/verify";
import type { EmailProvider, SendResult, SmsProvider, WhatsAppProvider } from "@/lib/communications/providers/types";
import { renderTemplate, validateTemplate } from "@/lib/communications/template-engine";
import { applyQuietHours, emitCommunication } from "@/lib/communications/dispatch";
import { processDue } from "@/lib/communications/worker";
import { handleWebhook, metaHandshake } from "@/lib/communications/webhooks";
import { onAppointmentEvent, runScheduler, scheduleForTenant, notifyInvoiceIssued } from "@/lib/communications/triggers";
import { toSettings } from "@/lib/communications/settings";
import { registerPatient } from "./patient-crm";
import { saveSchedule } from "./schedule";
import { createStaffAppointment, appointmentAction } from "./appointments";
import { getCommSettingsView, saveCommSettings, createTemplate, updateTemplate, setTemplateStatus, previewTemplate, listTemplates, listMessages, getMessage, resendMessage, commStats, entityComms } from "./comms-staff";
import { platformCommOverview } from "./comms-platform";
import { myCommunications } from "./portal-comms";
import { activatePortalAccount, issuePortalInvite } from "./portal-auth";
import { getPreferences, savePreferences } from "./portal-account";
import { createInvoice, issueInvoice } from "./billing-invoices";
import { saveService } from "./billing-master";
import { createFollowUp } from "./followups";

const TZ = "Asia/Kolkata";
const code = (p: Promise<unknown>) => p.then(() => "ok", (e) => (e instanceof AppError ? e.code : `ERR:${e}`));
type Ctx = ReturnType<typeof asTenant>;
interface T { id: string; slug: string; admin: Ctx; recep: Ctx; doctor: Ctx; accountant: Ctx; lab: Ctx; nurse: Ctx; doctorId: string; svc: string }
let phoneN = 0; const phone = () => `92${String(10000000 + ++phoneN * 23).slice(0, 8)}`;
let ipN = 0;

async function mkTenant(label: string): Promise<T> {
  const name = `Comm Clinic ${label}`;
  const t = await db.tenant.create({ data: { name, slug: uniq(`cm-${label}`).slice(0, 30), status: "ACTIVE", address: "1 Test Road", city: "Testville", contactPhone: "+911234500000", contactEmail: "clinic@comm.test" } });
  const mk = async (role: RoleKey) => { const { user } = await makeUser(role, t.id); const b = ctxFor(user, role, t.id); return { user, ctx: asTenant({ ...b, tenant: { ...b.tenant!, name, timezone: TZ, address: "1 Test Road", city: "Testville", contactPhone: "+911234500000", logoUrl: null, brand: { primary: "#0e7c86", secondary: "#000", accent: "#000" }, state: null, pincode: null, contactEmail: null, legalName: null } as never }) }; };
  const [a, r, d, ac, l, n] = [await mk("CLINIC_ADMIN"), await mk("RECEPTIONIST"), await mk("DOCTOR"), await mk("ACCOUNTANT"), await mk("LAB_STAFF"), await mk("NURSE")];
  await saveSchedule(a.ctx, d.user.id, { slotMinutes: 15, bufferMinutes: 0, onlineBooking: true, advanceDays: 60, minNoticeMinutes: 0, windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "09:00", end: "17:00" })) });
  const svc = (await saveService(a.ctx, null, { serviceCode: "C-1", serviceName: "Consultation", type: "CONSULTATION", priceMinor: 50000 })).id as string;
  return { id: t.id, slug: t.slug, admin: a.ctx, recep: r.ctx, doctor: d.ctx, accountant: ac.ctx, lab: l.ctx, nurse: n.ctx, doctorId: d.user.id, svc };
}
const settings = (t: T, over: Record<string, unknown> = {}) => saveCommSettings(t.admin, { whatsappEnabled: false, smsEnabled: true, emailEnabled: true, channelOrder: ["WHATSAPP", "SMS", "EMAIL"], senderName: null, replyTo: null, defaultLanguage: "en", eventToggles: {}, reminderOffsets: [1440], quietEnabled: false, quietStartMin: 1320, quietEndMin: 480, fallbackRules: {}, maxRetries: 3, dailyCapPerPatient: 8, ...over });
async function pat(t: T, over: Record<string, unknown> = {}) { const ph = phone(); const r = await registerPatient(t.recep, { name: "Comm Patient", phone: ph, email: `p${ph}@comm.test`, allowDuplicate: true, dateOfBirth: "1990-01-01", gender: "MALE", ...over }); return { id: r.id as string, phone: ph }; }

/** A stand-in adapter used ONLY to exercise the engine without contacting any vendor. */
class Stub<K extends "WHATSAPP" | "SMS" | "EMAIL"> { calls: Record<string, unknown>[] = []; next: SendResult[] = []; n = 0; constructor(public channel: K, public name = "stub") {} isConfigured = () => true; webhookReady = () => true; getMessageStatus = async () => null;
  parseWebhook = () => ({ verified: false, updates: [] });
  reply(c: Record<string, unknown>): SendResult { this.calls.push(c); return this.next.shift() ?? { ok: true, providerMessageId: `${this.channel}-${++this.n}-${Math.random().toString(36).slice(2, 8)}` }; }
}
function installStubs() {
  const wa = Object.assign(new Stub("WHATSAPP"), { sendTemplate: async (i: Record<string, unknown>) => wa.reply(i), sendMessage: async (i: Record<string, unknown>) => wa.reply(i) });
  const sms = Object.assign(new Stub("SMS"), { sendSMS: async (i: Record<string, unknown>) => sms.reply(i) });
  const email = Object.assign(new Stub("EMAIL"), { sendEmail: async (i: Record<string, unknown>) => email.reply(i) });
  __setProvider("WHATSAPP", wa as unknown as WhatsAppProvider); __setProvider("SMS", sms as unknown as SmsProvider); __setProvider("EMAIL", email as unknown as EmailProvider);
  return { wa, sms, email };
}
const msgs = (t: T, where: Record<string, unknown> = {}) => db.communicationMessage.findMany({ where: { tenantId: t.id, ...where }, orderBy: { createdAt: "asc" } });
const emit = (t: T, patientId: string, over: Record<string, unknown> = {}) => emitCommunication({ tenantId: t.id, event: "APPOINTMENT_CONFIRMED", patientId, eventKey: uniq("evt"), vars: { doctor_name: "Dr. Test", appointment_date: "12 Oct 2026", appointment_time: "10:30 AM" }, linkPath: "/portal/appointments/APT-1", ...over } as never);

let A: T, B: T;
beforeAll(async () => { await seedSystemData(); A = await mkTenant("a"); B = await mkTenant("b"); }, 120_000);
afterEach(() => { __setProvider("WHATSAPP", undefined); __setProvider("SMS", undefined); __setProvider("EMAIL", undefined); __setProviderFetch(null); });

describe("template engine", () => {
  it("replaces only whitelisted {{variables}} and never executes anything", () => {
    expect(renderTemplate("Hi {{patient_name}} {{ clinic_name }} {{evil}} ${1+1} {%x%}", { patient_name: "Gurjeet", clinic_name: "Demo" })).toBe("Hi Gurjeet Demo  ${1+1} {%x%}");
    expect(renderTemplate("{{patient_name}}", { patient_name: "A\u0000B\n\nC‮" })).toBe("AB C");
    expect(renderTemplate("{{patient_name}}", { patient_name: "x".repeat(500) }).length).toBe(200);
  });
  it("validates variables, length, subject, brace markers and WhatsApp template names", () => {
    expect(validateTemplate({ channel: "SMS", body: "Hi {{patient_name}}" })).toEqual([]);
    expect(validateTemplate({ channel: "SMS", body: "" })[0]).toMatch(/empty/);
    expect(validateTemplate({ channel: "SMS", body: "{{password}}" }).join()).toMatch(/Unsupported variable/);
    expect(validateTemplate({ channel: "SMS", body: "a".repeat(481) }).join()).toMatch(/too long/);
    expect(validateTemplate({ channel: "SMS", body: "hi {{ ", subject: null }).join()).toMatch(/stray brace/);
    expect(validateTemplate({ channel: "EMAIL", body: "x", subject: "" }).join()).toMatch(/needs a subject/);
    expect(validateTemplate({ channel: "EMAIL", body: "x", subject: "a\nb" }).join()).toMatch(/one line/);
    expect(validateTemplate({ channel: "SMS", body: "x", subject: "no" }).join()).toMatch(/Only email/);
    expect(validateTemplate({ channel: "WHATSAPP", body: "x", providerTemplateId: "Bad Name" }).join()).toMatch(/lowercase/);
    expect(validateTemplate({ channel: "WHATSAPP", body: "x", status: "ACTIVE" }).join()).toMatch(/approved/);
  });
});

describe("webhook signatures and provider adapters (no vendor is contacted)", () => {
  it("Meta / Twilio / Svix signatures verify and reject tampering", () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret-123"; process.env.SMS_API_KEY = "twilio-token-123"; process.env.EMAIL_WEBHOOK_SECRET = `whsec_${Buffer.from("svix-secret").toString("base64")}`;
    const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.1", status: "delivered", timestamp: "1700000000" }] } }] }] });
    const sig = `sha256=${createHmac("sha256", "app-secret-123").update(body).digest("hex")}`;
    expect(metaWhatsApp.parseWebhook({ method: "POST", url: "u", headers: new Headers({ "x-hub-signature-256": sig }), rawBody: body, query: new URLSearchParams() })).toMatchObject({ verified: true, updates: [{ providerMessageId: "wamid.1", status: "DELIVERED" }] });
    expect(metaWhatsApp.parseWebhook({ method: "POST", url: "u", headers: new Headers({ "x-hub-signature-256": sig }), rawBody: body + " ", query: new URLSearchParams() }).verified).toBe(false);
    expect(metaWhatsApp.parseWebhook({ method: "POST", url: "u", headers: new Headers(), rawBody: body, query: new URLSearchParams() }).verified).toBe(false);
    const form = "MessageSid=SM1&MessageStatus=delivered"; const url = "https://app.test/api/webhooks/sms"; const ts = twilioSignature("twilio-token-123", url, { MessageSid: "SM1", MessageStatus: "delivered" });
    expect(twilioSms.parseWebhook({ method: "POST", url, headers: new Headers({ "x-twilio-signature": ts }), rawBody: form, query: new URLSearchParams() })).toMatchObject({ verified: true, updates: [{ providerMessageId: "SM1", status: "DELIVERED" }] });
    expect(twilioSms.parseWebhook({ method: "POST", url, headers: new Headers({ "x-twilio-signature": "x" }), rawBody: form, query: new URLSearchParams() }).verified).toBe(false);
    const ebody = JSON.stringify({ type: "email.delivered", data: { email_id: "em_1" } }); const now = String(Math.floor(Date.now() / 1000));
    const h = (id: string, t: string, s: string) => new Headers({ "svix-id": id, "svix-timestamp": t, "svix-signature": `v1,${s}` });
    expect(resendEmail.parseWebhook({ method: "POST", url: "u", headers: h("m1", now, svixSignature(process.env.EMAIL_WEBHOOK_SECRET!, "m1", now, ebody)), rawBody: ebody, query: new URLSearchParams() })).toMatchObject({ verified: true, updates: [{ providerMessageId: "em_1", status: "DELIVERED" }] });
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(resendEmail.parseWebhook({ method: "POST", url: "u", headers: h("m2", old, svixSignature(process.env.EMAIL_WEBHOOK_SECRET!, "m2", old, ebody)), rawBody: ebody, query: new URLSearchParams() })).toMatchObject({ verified: false, reason: "stale_timestamp" }); // replay window
  });
  it("Meta handshake needs the right verify token", () => {
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
    expect(metaHandshake(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" }))).toEqual({ status: 200, body: "42" });
    expect(metaHandshake(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42" })).status).toBe(403);
  });
  it("adapters build the real vendor requests and classify errors (retryable vs permanent)", async () => {
    Object.assign(process.env, { WHATSAPP_PROVIDER: "meta", WHATSAPP_ACCESS_TOKEN: "wa-token-xyz", WHATSAPP_PHONE_NUMBER_ID: "123", SMS_PROVIDER: "twilio", SMS_ACCOUNT_SID: "ACxxx", SMS_API_KEY: "tw-secret-key", SMS_SENDER_ID: "+15005550006", EMAIL_PROVIDER: "resend", EMAIL_API_KEY: "re_secret_key", EMAIL_FROM: "noreply@clinic.test" });
    const seen: { url: string; init: RequestInit }[] = []; let reply: () => Response = () => new Response(JSON.stringify({ messages: [{ id: "wamid.9" }], sid: "SM9", id: "em_9" }), { status: 200 });
    __setProviderFetch((async (url: string, init: RequestInit) => { seen.push({ url, init }); return reply(); }) as never);
    const w = await metaWhatsApp.sendTemplate({ to: "+919876543210", templateName: "appt_confirmed", language: "en", params: ["Gurjeet", "10:30"] });
    expect(w).toEqual({ ok: true, providerMessageId: "wamid.9" }); expect(seen[0].url).toContain("/123/messages"); expect(JSON.parse(String(seen[0].init.body))).toMatchObject({ to: "919876543210", type: "template", template: { name: "appt_confirmed", components: [{ parameters: [{ text: "Gurjeet" }, { text: "10:30" }] }] } });
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe("Bearer wa-token-xyz");
    expect(await twilioSms.sendSMS({ to: "+919876543210", text: "hello" })).toEqual({ ok: true, providerMessageId: "SM9" }); expect(String(seen[1].init.body)).toContain("From=%2B15005550006");
    expect(await resendEmail.sendEmail({ to: "p@x.test", fromName: "Clinic <x>\n", subject: "S", html: "<p>h</p>", text: "t" })).toEqual({ ok: true, providerMessageId: "em_9" }); expect(JSON.parse(String(seen[2].init.body)).from).toBe("Clinic x <noreply@clinic.test>");
    reply = () => new Response(JSON.stringify({ error: { message: "bad token wa-token-xyz" } }), { status: 401 });
    const bad = await metaWhatsApp.sendTemplate({ to: "+91", templateName: "x", language: "en", params: [] }); expect(bad).toMatchObject({ ok: false, retryable: false, code: "HTTP_401" }); expect(JSON.stringify(bad)).not.toContain("wa-token-xyz"); // secrets scrubbed
    reply = () => new Response("{}", { status: 503 }); expect(await twilioSms.sendSMS({ to: "+91", text: "x" })).toMatchObject({ ok: false, retryable: true, code: "HTTP_503" });
    reply = () => new Response("{}", { status: 429 }); expect(await resendEmail.sendEmail({ to: "a@b.c", fromName: "C", subject: "s", html: "h", text: "t" })).toMatchObject({ retryable: true });
    __setProviderFetch((async () => { throw new TypeError("fetch failed"); }) as never); expect(await metaWhatsApp.sendMessage({ to: "+91", text: "x" })).toMatchObject({ ok: false, retryable: true, code: "NETWORK_ERROR" });
    reply = () => new Response("{}", { status: 200 }); __setProviderFetch((async () => reply()) as never); expect(await metaWhatsApp.sendMessage({ to: "+91", text: "x" })).toMatchObject({ ok: false, code: "NO_MESSAGE_ID" });
    for (const k of ["WHATSAPP_PROVIDER", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "SMS_PROVIDER", "SMS_ACCOUNT_SID", "SMS_API_KEY", "SMS_SENDER_ID", "EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM"]) delete process.env[k];
  });
  it("no provider configured => nothing is 'sent' (the message is recorded as NOT SENT with the reason)", async () => {
    await settings(A); const p = await pat(A); const r = await emit(A, p.id);
    expect(r.queued).toHaveLength(0); expect(r.skipped).toBe("PROVIDER_NOT_CONFIGURED");
    const row = (await msgs(A, { patientId: p.id }))[0]; expect(row).toMatchObject({ status: "SKIPPED", failureCode: "PROVIDER_NOT_CONFIGURED", providerMessageId: null, sentAt: null });
    expect(await db.communicationAttempt.count({ where: { messageId: row.id, status: "SENT" } })).toBe(0);
  });
});

describe("eligibility: preferences, consent, channels, templates", () => {
  it("SMS first when WhatsApp isn't opted in; ONE channel only", async () => {
    installStubs(); await settings(A, { whatsappEnabled: true }); const p = await pat(A);
    const r = await emit(A, p.id); expect(r.queued).toHaveLength(1);
    const rows = await msgs(A, { patientId: p.id }); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ channel: "SMS", status: "QUEUED", category: "TRANSACTIONAL" });
    expect(rows[0].body).toContain("Comm Clinic a"); expect(rows[0].body).toContain("Dr. Test"); expect(rows[0].link).toContain("/portal/appointments/APT-1"); expect(rows[0].link).toContain(`clinic=${A.slug}`);
  });
  it("WhatsApp needs explicit opt-in AND an approved template; otherwise it is skipped, never sent", async () => {
    const s = installStubs(); await settings(A, { whatsappEnabled: true, smsEnabled: false, emailEnabled: false }); const p = await pat(A);
    await db.patient.update({ where: { id: p.id }, data: { prefWhatsapp: "ALLOWED" } });
    expect((await emit(A, p.id)).skipped).toBe("NO_TEMPLATE"); // no clinic template with a provider template name
    const t = await createTemplate(A.admin, { channel: "WHATSAPP", eventType: "APPOINTMENT_CONFIRMED", language: "en", name: "wa confirm", body: "Dear {{patient_name}}, confirmed {{appointment_date}} {{appointment_time}}", providerTemplateId: "appointment_confirmed" });
    expect(await code(setTemplateStatus(A.admin, t.id, { status: "ACTIVE" }))).toBe("ok");
    const r = await emit(A, p.id); expect(r.queued).toHaveLength(1);
    await processDue({ tenantId: A.id }); expect(s.wa.calls).toHaveLength(1); expect(s.wa.calls[0]).toMatchObject({ templateName: "appointment_confirmed", language: "en" }); expect((s.wa.calls[0].params as string[])[0]).toBe("Comm");
    const q = await pat(A); expect((await emit(A, q.id)).skipped).toBe("WHATSAPP_NOT_OPTED_IN"); // not opted in -> skipped, never sent
    expect((await msgs(A, { patientId: q.id }))[0].failureCode).toBe("WHATSAPP_NOT_OPTED_IN");
  });
  it("opt-out, withdrawn consent, category switch, missing contact and archived patient all block", async () => {
    installStubs(); await settings(A); const rows = async (id: string) => (await msgs(A, { patientId: id, eventType: "APPOINTMENT_CONFIRMED" })).map((m) => m.failureCode ?? m.status);
    const a = await pat(A); await db.patient.update({ where: { id: a.id }, data: { prefSms: "NOT_ALLOWED", prefEmail: "NOT_ALLOWED" } }); await emit(A, a.id); expect(await rows(a.id)).toEqual(["CHANNEL_OPT_OUT"]);
    const b = await pat(A); await db.patientConsent.create({ data: { tenantId: A.id, patientId: b.id, type: "COMMUNICATION", status: "WITHDRAWN", version: "v1" } }); await emit(A, b.id); expect(await rows(b.id)).toEqual(["NO_CONSENT"]);
    const c = await pat(A); await db.patientConsent.create({ data: { tenantId: A.id, patientId: c.id, type: "COMMUNICATION", status: "WITHDRAWN", version: "v1" } }); // security alerts still go out
    expect((await emit(A, c.id, { event: "ACCOUNT_SECURITY_ALERT", vars: { security_event: "your password was changed" } })).queued).toHaveLength(1);
    const d = await pat(A); const acct = await makeAccount(A, d.id, d.phone); await db.patientAccount.update({ where: { id: acct }, data: { prefs: JSON.stringify({ appointments: false }) } }); await emit(A, d.id); expect(await rows(d.id)).toEqual(["CATEGORY_OFF"]);
    const e = await pat(A); await db.patient.update({ where: { id: e.id }, data: { phone: null, email: null } }); await emit(A, e.id); expect(await rows(e.id)).toEqual(["NO_CONTACT"]);
    const f = await pat(A); await db.patient.update({ where: { id: f.id }, data: { status: "ARCHIVED" } }); expect((await emit(A, f.id)).skipped).toBe("PATIENT_UNAVAILABLE");
  });
  it("marketing needs explicit channel opt-in AND communication consent", async () => {
    installStubs(); await settings(A, { eventToggles: { CLINIC_ANNOUNCEMENT: true } }); const p = await pat(A);
    await emit(A, p.id, { event: "CLINIC_ANNOUNCEMENT" }); expect((await msgs(A, { patientId: p.id }))[0].failureCode).toBe("NO_CONSENT");
    await db.patient.update({ where: { id: p.id }, data: { prefSms: "ALLOWED" } }); await db.patientConsent.create({ data: { tenantId: A.id, patientId: p.id, type: "COMMUNICATION", status: "GRANTED", version: "v1" } });
    expect((await emit(A, p.id, { event: "CLINIC_ANNOUNCEMENT" })).queued).toHaveLength(1); expect((await msgs(A, { patientId: p.id, status: "QUEUED" }))[0].category).toBe("MARKETING");
  });
  it("clinic switches: event off, all channels off, per-event defaults", async () => {
    installStubs(); const p = await pat(A);
    await settings(A, { eventToggles: { APPOINTMENT_CONFIRMED: false } }); expect((await emit(A, p.id)).skipped).toBe("EVENT_DISABLED");
    await settings(A, { smsEnabled: false, emailEnabled: false }); expect((await emit(A, p.id, { event: "PRESCRIPTION_AVAILABLE" })).skipped).toBe("NO_CHANNEL_ENABLED");
    expect(await msgs(A, { patientId: p.id })).toHaveLength(0); // nothing configured => no noise
    await settings(A); expect((await emit(A, p.id, { event: "OPD_CHECKED_IN", vars: { token_number: "07" } })).skipped).toBe("EVENT_DISABLED"); // off by default
  });
  it("daily cap per patient stops message floods (security exempt)", async () => {
    installStubs(); await settings(A, { dailyCapPerPatient: 2, emailEnabled: false }); const p = await pat(A);
    for (let i = 0; i < 3; i++) await emit(A, p.id); const rows = await msgs(A, { patientId: p.id }); expect(rows.filter((r) => r.status === "QUEUED")).toHaveLength(2); expect(rows.filter((r) => r.failureCode === "RATE_LIMITED")).toHaveLength(1);
    expect((await emit(A, p.id, { event: "ACCOUNT_SECURITY_ALERT" })).queued).toHaveLength(1);
  });
  it("language: patient's choice, then clinic default, then English; built-in Hindi/Punjabi exist", async () => {
    installStubs(); await settings(A, { emailEnabled: false, defaultLanguage: "hi" }); const p = await pat(A); await emit(A, p.id); expect((await msgs(A, { patientId: p.id }))[0]).toMatchObject({ language: "hi" });
    const q = await pat(A); const acct = await makeAccount(A, q.id, q.phone); await db.patientAccount.update({ where: { id: acct }, data: { prefs: JSON.stringify({ language: "pa" }) } }); await emit(A, q.id); expect((await msgs(A, { patientId: q.id, eventType: "APPOINTMENT_CONFIRMED" }))[0]).toMatchObject({ language: "pa" }); expect((await msgs(A, { patientId: q.id, eventType: "APPOINTMENT_CONFIRMED" }))[0].body).toContain("ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ");
    await emit(A, q.id, { event: "OPD_CALLED", eventKey: uniq("o"), ignoreToggle: true, vars: { token_number: "3" } }); expect((await msgs(A, { patientId: q.id, eventType: "OPD_CALLED" }))[0].language).toBe("en"); // no Punjabi text => English
  });
  it("a clinic template overrides the built-in text; editing a live template returns it to draft", async () => {
    installStubs(); await settings(A, { emailEnabled: false }); const p = await pat(A);
    const t = await createTemplate(A.admin, { channel: "SMS", eventType: "APPOINTMENT_CONFIRMED", language: "en", name: "mine", body: "CUSTOM {{patient_name}} at {{clinic_name}}" });
    await setTemplateStatus(A.admin, t.id, { status: "ACTIVE" }); await emit(A, p.id); expect((await msgs(A, { patientId: p.id }))[0].body).toBe("CUSTOM Comm at Comm Clinic a");
    expect((await updateTemplate(A.admin, t.id, { channel: "SMS", eventType: "APPOINTMENT_CONFIRMED", language: "en", name: "mine", body: "CHANGED {{patient_name}}" })).status).toBe("DRAFT");
    const q = await pat(A); await emit(A, q.id); expect((await msgs(A, { patientId: q.id }))[0].body).not.toContain("CHANGED"); // not live until re-activated
    await setTemplateStatus(A.admin, t.id, { status: "INACTIVE" });
  });
  it("quiet hours hold routine messages until they end, in the clinic's time zone; high priority is never held", () => {
    const s = toSettings({ quietEnabled: true, quietStartMin: 22 * 60, quietEndMin: 8 * 60 });
    const late = zonedToUtc("2026-10-12", 23 * 60, TZ); const held = applyQuietHours(s, TZ, late, "NORMAL");
    expect(held.getTime()).toBe(zonedToUtc("2026-10-13", 8 * 60, TZ).getTime()); expect(applyQuietHours(s, TZ, zonedToUtc("2026-10-12", 3 * 60, TZ), "LOW").getTime()).toBe(zonedToUtc("2026-10-12", 8 * 60, TZ).getTime());
    expect(applyQuietHours(s, TZ, late, "HIGH").getTime()).toBe(late.getTime()); expect(applyQuietHours(s, TZ, zonedToUtc("2026-10-12", 12 * 60, TZ), "NORMAL").getTime()).toBe(zonedToUtc("2026-10-12", 12 * 60, TZ).getTime());
    expect(applyQuietHours(toSettings({ quietEnabled: false }), TZ, late, "NORMAL").getTime()).toBe(late.getTime());
  });
});

async function makeAccount(t: T, patientId: string, ph: string) {
  const inv = await issuePortalInvite(t.recep, patientId);
  await activatePortalAccount({ clinic: t.slug, code: inv.code, identifier: ph, password: "Strong-Pass-123!", confirm: "Strong-Pass-123!", acceptPrivacy: true }, `10.7.0.${++ipN}`);
  return (await db.patientAccount.findFirstOrThrow({ where: { patientId } })).id;
}

describe("idempotency", () => {
  it("the same business event can never create two messages (also under parallel calls)", async () => {
    installStubs(); await settings(A, { emailEnabled: false }); const p = await pat(A); const key = uniq("dup");
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => emit(A, p.id, { eventKey: key })));
    expect(rs.filter((r) => r.queued.length === 1)).toHaveLength(1); expect(rs.filter((r) => r.duplicate)).toHaveLength(4);
    expect(await msgs(A, { patientId: p.id })).toHaveLength(1);
  });
  it("a repeated appointment event sends one confirmation; a new time sends a new reschedule message", async () => {
    installStubs(); await settings(A, { emailEnabled: false }); const p = await pat(A); const day = addDays(todayIn(TZ), 3);
    const a = await createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: zonedToUtc(day, 10 * 60, TZ).toISOString(), patient: { patientId: p.id, viaProfile: true } }) as { id: string };
    const ev = { name: "appointment.confirmed" as const, tenantId: A.id, appointmentId: a.id, at: new Date() };
    await onAppointmentEvent(ev); await onAppointmentEvent(ev); await onAppointmentEvent({ ...ev, name: "appointment.created" });
    expect((await msgs(A, { patientId: p.id, eventType: "APPOINTMENT_CONFIRMED" }))).toHaveLength(1);
    await appointmentAction(A.recep, a.id, { action: "reschedule", startsAt: zonedToUtc(day, 11 * 60, TZ).toISOString() });
    expect((await msgs(A, { patientId: p.id, eventType: "APPOINTMENT_RESCHEDULED" }))).toHaveLength(1);
    await onAppointmentEvent({ ...ev, name: "appointment.rescheduled" }); expect((await msgs(A, { patientId: p.id, eventType: "APPOINTMENT_RESCHEDULED" }))).toHaveLength(1);
    await appointmentAction(A.recep, a.id, { action: "cancel", reasonKind: "PATIENT_REQUEST" });
    const all = await msgs(A, { patientId: p.id }); expect(all.map((m) => m.eventType).sort()).toEqual(["APPOINTMENT_CANCELLED", "APPOINTMENT_CONFIRMED", "APPOINTMENT_RESCHEDULED"]);
    expect(all.find((m) => m.eventType === "APPOINTMENT_CANCELLED")!.link).toBeNull(); // nothing to open for a cancelled booking
    expect(JSON.stringify(all)).not.toMatch(/diagnos|prescri.*mg|result/i);
  });
});

describe("delivery worker: success, retry, failure, fallback, claims", () => {
  it("sends once, records the provider id, and 'accepted' is not 'delivered'", async () => {
    const s = installStubs(); await settings(A, { emailEnabled: false }); await processDue({ tenantId: A.id, limit: 200 }); s.sms.calls = []; const p = await pat(A); await emit(A, p.id);
    const r = await processDue({ tenantId: A.id }); expect(r).toMatchObject({ sent: 1 }); expect(s.sms.calls).toHaveLength(1); expect(s.sms.calls[0]).toMatchObject({ to: `+91${p.phone}` });
    const m = (await msgs(A, { patientId: p.id }))[0]; expect(m).toMatchObject({ status: "SENT", attempts: 1 }); expect(m.providerMessageId).toMatch(/^SMS-/); expect(m.deliveredAt).toBeNull();
    expect((await processDue({ tenantId: A.id })).claimed).toBe(0); // never sent twice
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "comm.message_sent", entityId: m.id } })).toBe(1);
  });
  it("temporary failures retry with backoff, then fail for good; permanent errors don't retry", async () => {
    const s = installStubs(); await settings(A, { emailEnabled: false, maxRetries: 2 }); const p = await pat(A); await emit(A, p.id);
    s.sms.next = [{ ok: false, retryable: true, code: "TIMEOUT", message: "slow" }, { ok: false, retryable: true, code: "TIMEOUT", message: "slow" }, { ok: false, retryable: true, code: "HTTP_503", message: "down" }];
    const id = (await msgs(A, { patientId: p.id }))[0].id; const at = async () => (await db.communicationMessage.findUniqueOrThrow({ where: { id } }));
    await processDue({ tenantId: A.id }); let m = await at(); expect(m).toMatchObject({ status: "RETRYING", attempts: 1, failureCode: "TIMEOUT" }); expect(m.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect((await processDue({ tenantId: A.id })).claimed).toBe(0); // not due yet
    await db.communicationMessage.update({ where: { id }, data: { nextAttemptAt: new Date() } }); await processDue({ tenantId: A.id }); expect((await at()).status).toBe("RETRYING");
    await db.communicationMessage.update({ where: { id }, data: { nextAttemptAt: new Date() } }); await processDue({ tenantId: A.id }); m = await at(); expect(m).toMatchObject({ status: "FAILED", attempts: 3 }); expect(m.failureReason).toMatch(/gave up/);
    expect(s.sms.calls).toHaveLength(3); expect(await db.auditLog.count({ where: { tenantId: A.id, entityId: id, action: "comm.message_retried" } })).toBe(2);
    const q = await pat(A); await emit(A, q.id); s.sms.next = [{ ok: false, retryable: false, code: "HTTP_400", message: "invalid number" }]; await processDue({ tenantId: A.id });
    expect((await msgs(A, { patientId: q.id }))[0]).toMatchObject({ status: "FAILED", attempts: 1, failureCode: "HTTP_400" });
  });
  it("fallback happens ONLY when configured, and only if the patient allows the other channel", async () => {
    const s = installStubs(); await settings(A, { whatsappEnabled: true, smsEnabled: true, emailEnabled: false, fallbackRules: { WHATSAPP: "SMS" } });
    const tpl = await createTemplate(A.admin, { channel: "WHATSAPP", eventType: "PRESCRIPTION_AVAILABLE", language: "en", name: "wa rx", body: "Dear {{patient_name}} {{portal_link}}", providerTemplateId: "rx_ready" }); await setTemplateStatus(A.admin, tpl.id, { status: "ACTIVE" });
    const p = await pat(A); await db.patient.update({ where: { id: p.id }, data: { prefWhatsapp: "ALLOWED" } }); await emit(A, p.id, { event: "PRESCRIPTION_AVAILABLE", vars: { prescription_number: "RX-1" } });
    s.wa.next = [{ ok: false, retryable: false, code: "HTTP_400", message: "template rejected" }]; await processDue({ tenantId: A.id });
    const rows = await msgs(A, { patientId: p.id }); expect(rows.map((r) => `${r.channel}:${r.status}`)).toEqual(["WHATSAPP:FAILED", "SMS:QUEUED"]); expect(rows[1].fallbackOfId).toBe(rows[0].id);
    await processDue({ tenantId: A.id }); expect(s.sms.calls).toHaveLength(1);
    // no rule => no fallback
    await settings(A, { whatsappEnabled: true, smsEnabled: true, emailEnabled: false, fallbackRules: {} }); const q = await pat(A); await db.patient.update({ where: { id: q.id }, data: { prefWhatsapp: "ALLOWED" } });
    await emit(A, q.id, { event: "PRESCRIPTION_AVAILABLE" }); s.wa.next = [{ ok: false, retryable: false, code: "HTTP_400", message: "x" }]; await processDue({ tenantId: A.id }); expect(await msgs(A, { patientId: q.id })).toHaveLength(1);
    // fallback channel the patient refuses => none
    await settings(A, { whatsappEnabled: true, smsEnabled: true, emailEnabled: false, fallbackRules: { WHATSAPP: "SMS" } }); const r = await pat(A); await db.patient.update({ where: { id: r.id }, data: { prefWhatsapp: "ALLOWED", prefSms: "NOT_ALLOWED" } });
    await emit(A, r.id, { event: "PRESCRIPTION_AVAILABLE" }); s.wa.next = [{ ok: false, retryable: false, code: "HTTP_400", message: "x" }]; await processDue({ tenantId: A.id }); expect((await msgs(A, { patientId: r.id })).filter((m) => m.channel === "SMS" && m.status === "QUEUED")).toHaveLength(0);
  });
  it("a reminder for an appointment that was cancelled meanwhile is cancelled, not sent", async () => {
    const s = installStubs(); await settings(A, { emailEnabled: false }); const p = await pat(A); const day = addDays(todayIn(TZ), 4);
    const a = await createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: zonedToUtc(day, 10 * 60 + 15, TZ).toISOString(), patient: { patientId: p.id, viaProfile: true } }) as { id: string };
    await emit(A, p.id, { event: "APPOINTMENT_REMINDER", entityType: "appointment", entityId: a.id, eventKey: uniq("r") });
    await db.appointment.update({ where: { id: a.id }, data: { status: "CANCELLED" } }); const before = s.sms.calls.length; await processDue({ tenantId: A.id });
    expect(s.sms.calls.length).toBe(before); expect((await msgs(A, { patientId: p.id, eventType: "APPOINTMENT_REMINDER" }))[0]).toMatchObject({ status: "CANCELLED", failureCode: "ENTITY_CHANGED" });
  });
  it("preferences changed after queueing are honoured at send time; channel switched off => cancelled", async () => {
    const s = installStubs(); await settings(A, { emailEnabled: false }); const p = await pat(A); await emit(A, p.id); await db.patient.update({ where: { id: p.id }, data: { prefSms: "NOT_ALLOWED" } });
    const before = s.sms.calls.length; await processDue({ tenantId: A.id }); expect(s.sms.calls.length).toBe(before); expect((await msgs(A, { patientId: p.id }))[0].failureCode).toBe("CHANNEL_OPT_OUT");
    const q = await pat(A); await emit(A, q.id); await settings(A, { smsEnabled: false, emailEnabled: false }); await processDue({ tenantId: A.id }); expect((await msgs(A, { patientId: q.id }))[0]).toMatchObject({ status: "CANCELLED", failureCode: "CHANNEL_DISABLED" });
  });
  it("two workers can't send the same message (claim by compare-and-swap)", async () => {
    const s = installStubs(); await settings(A, { emailEnabled: false }); const p = await pat(A); await emit(A, p.id);
    const before = s.sms.calls.length; await Promise.all([processDue({ tenantId: A.id }), processDue({ tenantId: A.id }), processDue({ tenantId: A.id })]); expect(s.sms.calls.length - before).toBe(1);
  });
  it("email carries clinic branding, escapes input and links to the portal (no medical data)", async () => {
    const s = installStubs(); await settings(A, { smsEnabled: false, senderName: "Sharma <Clinic>" }); await db.tenantBranding.upsert({ where: { tenantId: A.id }, update: { primaryColor: "#aa0011" }, create: { tenantId: A.id, primaryColor: "#aa0011" } });
    const p = await pat(A, { name: "<script>alert(1)</script> Eve" }); await emit(A, p.id, { event: "LAB_REPORT_RELEASED", vars: { report_number: "LAB-1" }, linkPath: "/portal/reports/r1" }); await processDue({ tenantId: A.id });
    const c = s.email.calls[s.email.calls.length - 1] as { html: string; text: string; subject: string; fromName: string }; expect(c.html).toContain("#aa0011"); expect(c.html).not.toContain("<script>"); expect(c.html).toContain("&lt;script&gt;"); expect(c.html).toContain("/portal/reports/r1"); expect(c.html).not.toContain("MECGURA");
    expect(c.fromName).toBe("Sharma <Clinic>"); expect(c.subject).toMatch(/lab report/i); expect(c.text).toContain("/portal/reports/r1");
  });
  it("a crashed worker's stuck message is recovered", async () => {
    const s = installStubs(); await settings(A, { emailEnabled: false }); const p = await pat(A); await emit(A, p.id); const m = (await msgs(A, { patientId: p.id }))[0];
    await db.communicationMessage.update({ where: { id: m.id }, data: { status: "PROCESSING", updatedAt: new Date(Date.now() - 3_600_000) } }); const before = s.sms.calls.length;
    await db.$executeRawUnsafe(`UPDATE "CommunicationMessage" SET "updatedAt" = datetime('now','-1 hour') WHERE id = '${m.id}'`).catch(() => null);
    await processDue({ tenantId: A.id }); expect(s.sms.calls.length - before).toBeLessThanOrEqual(1);
  });
});

describe("webhooks: delivery tracking", () => {
  const signed = (secret: string, statuses: unknown[]) => { const rawBody = JSON.stringify({ entry: [{ changes: [{ value: { statuses } }] }] }); return { method: "POST", url: "https://app.test/api/webhooks/whatsapp", headers: new Headers({ "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}` }), rawBody, query: new URLSearchParams() }; };
  async function sentMsg(t: T, id = "wamid.T") {
    const p = await pat(t); const m = await db.communicationMessage.create({ data: { tenantId: t.id, patientId: p.id, channel: "WHATSAPP", eventType: "APPOINTMENT_CONFIRMED", recipient: `+91${p.phone}`, body: "x", provider: "meta", providerMessageId: id, status: "SENT", sentAt: new Date(), dedupeKey: uniq("w") } }); return m;
  }
  it("rejects unsigned/forged callbacks, changes nothing, and is off without a secret", async () => {
    process.env.WHATSAPP_PROVIDER = "meta"; process.env.WHATSAPP_ACCESS_TOKEN = "t".repeat(10); process.env.WHATSAPP_PHONE_NUMBER_ID = "1"; delete process.env.WHATSAPP_APP_SECRET;
    const m = await sentMsg(A, uniq("wamid")); const req = signed("any", [{ id: m.providerMessageId, status: "delivered", timestamp: "1" }]);
    expect((await handleWebhook("whatsapp", req, "1.1.1.1")).status).toBe(503); // no secret => never trusted
    process.env.WHATSAPP_APP_SECRET = "right-secret";
    expect((await handleWebhook("whatsapp", signed("wrong-secret", [{ id: m.providerMessageId, status: "delivered", timestamp: "1" }]), "1.1.1.1")).status).toBe(401);
    expect((await handleWebhook("whatsapp", { ...req, headers: new Headers() }, "1.1.1.1")).status).toBe(401);
    expect((await db.communicationMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("SENT");
    expect(await db.auditLog.count({ where: { action: "comm.webhook_rejected" } })).toBeGreaterThan(0);
    expect((await handleWebhook("nonsense", req, "1.1.1.1")).status).toBe(404);
  });
  it("applies delivered/read once (replay-safe) and never moves backwards", async () => {
    process.env.WHATSAPP_APP_SECRET = "right-secret"; const m = await sentMsg(A, uniq("wamid"));
    const d = signed("right-secret", [{ id: m.providerMessageId, status: "delivered", timestamp: "1700000000" }]);
    expect((await handleWebhook("whatsapp", d, "2.2.2.2")).body).toMatchObject({ applied: 1 }); expect((await handleWebhook("whatsapp", d, "2.2.2.2")).body).toMatchObject({ applied: 0, duplicate: 1 });
    await handleWebhook("whatsapp", signed("right-secret", [{ id: m.providerMessageId, status: "read", timestamp: "1700000050" }]), "2.2.2.2");
    await handleWebhook("whatsapp", signed("right-secret", [{ id: m.providerMessageId, status: "sent", timestamp: "1700000099" }]), "2.2.2.2"); // late 'sent' must not undo 'read'
    const row = await db.communicationMessage.findUniqueOrThrow({ where: { id: m.id } }); expect(row.status).toBe("READ"); expect(row.deliveredAt).not.toBeNull(); expect(row.readAt).not.toBeNull();
    expect(await db.communicationAttempt.count({ where: { messageId: m.id, source: "WEBHOOK" } })).toBe(2);
  });
  it("a failure callback marks FAILED (unless already delivered) and an unknown message id is ignored", async () => {
    process.env.WHATSAPP_APP_SECRET = "right-secret"; const m = await sentMsg(A, uniq("wamid"));
    await handleWebhook("whatsapp", signed("right-secret", [{ id: m.providerMessageId, status: "failed", timestamp: "5", errors: [{ code: 131026 }] }]), "3.3.3.3");
    expect(await db.communicationMessage.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "FAILED", failureCode: "META_131026" });
    expect((await handleWebhook("whatsapp", signed("right-secret", [{ id: "wamid.unknown", status: "delivered", timestamp: "9" }]), "3.3.3.3")).body).toMatchObject({ unknown: 1 });
    const d = await sentMsg(A, uniq("wamid")); await handleWebhook("whatsapp", signed("right-secret", [{ id: d.providerMessageId, status: "delivered", timestamp: "7" }]), "3.3.3.3");
    await handleWebhook("whatsapp", signed("right-secret", [{ id: d.providerMessageId, status: "failed", timestamp: "8" }]), "3.3.3.3"); expect((await db.communicationMessage.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("DELIVERED");
    delete process.env.WHATSAPP_PROVIDER; delete process.env.WHATSAPP_ACCESS_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID; delete process.env.WHATSAPP_APP_SECRET;
  });
});

describe("business triggers and failure isolation", () => {
  it("a broken communication layer never breaks the business action", async () => {
    installStubs(); await settings(A, { emailEnabled: false }); const p = await pat(A); const day = addDays(todayIn(TZ), 5);
    const orig = db.communicationSettings.findUnique; (db.communicationSettings as { findUnique: unknown }).findUnique = async () => { throw new Error("db down"); };
    try {
      const a = await createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: zonedToUtc(day, 10 * 60, TZ).toISOString(), patient: { patientId: p.id, viaProfile: true } }) as { id: string };
      expect((await db.appointment.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CONFIRMED");
      const inv = await createInvoice(A.recep, { patientId: p.id, items: [{ serviceId: A.svc }] }) as { id: string }; expect(await code(issueInvoice(A.recep, inv.id))).toBe("ok");
      expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("ISSUED");
    } finally { (db.communicationSettings as { findUnique: unknown }).findUnique = orig; }
  });
  it("invoice issue, follow-up creation and account events produce the right messages", async () => {
    installStubs(); await settings(A, { emailEnabled: false, eventToggles: { FOLLOW_UP_CREATED: true } }); const p = await pat(A);
    const inv = await createInvoice(A.recep, { patientId: p.id, items: [{ serviceId: A.svc }] }) as { id: string }; await issueInvoice(A.recep, inv.id); await notifyInvoiceIssued(A.id, inv.id);
    await createFollowUp(A.recep, { patientId: p.id, title: "Come back", afterDays: 3 });
    const acct = await makeAccount(A, p.id, p.phone); expect(acct).toBeTruthy();
    const types = (await msgs(A, { patientId: p.id })).map((m) => m.eventType).sort(); expect(types).toEqual(["FOLLOW_UP_CREATED", "INVOICE_CREATED", "PATIENT_ACCOUNT_ACTIVATED"]);
    const invMsg = (await msgs(A, { patientId: p.id, eventType: "INVOICE_CREATED" }))[0]; expect(invMsg.body).toContain("INV-"); expect(invMsg.body).not.toMatch(/₹|card|cvv|upi/i); expect(invMsg.link).toContain("/portal/billing/invoices/");
  });
  it("a draft invoice or unreleased report never notifies", async () => {
    installStubs(); await settings(A, { emailEnabled: false }); const p = await pat(A); const inv = await createInvoice(A.recep, { patientId: p.id, items: [{ serviceId: A.svc }] }) as { id: string };
    await notifyInvoiceIssued(A.id, inv.id); expect(await msgs(A, { patientId: p.id })).toHaveLength(0);
  });
});

describe("scheduler: reminders", () => {
  it("queues each reminder once, only inside its window, in the clinic's clock", async () => {
    installStubs(); await settings(A, { emailEnabled: false, reminderOffsets: [1440, 120] }); const p = await pat(A);
    const day = addDays(todayIn(TZ), 2); const start = zonedToUtc(day, 14 * 60, TZ);
    const a = await createStaffAppointment(A.recep, { doctorUserId: A.doctorId, startsAt: start.toISOString(), patient: { patientId: p.id, viaProfile: true } }) as { id: string };
    await db.appointment.update({ where: { id: a.id }, data: { createdAt: new Date(start.getTime() - 3 * 86_400_000) } });
    const count = () => db.communicationMessage.count({ where: { tenantId: A.id, patientId: p.id, eventType: "APPOINTMENT_REMINDER" } });
    await scheduleForTenant(A.id, new Date(start.getTime() - 3 * 86_400_000)); expect(await count()).toBe(0); // too early
    const t1 = new Date(start.getTime() - 1400 * 60_000); await scheduleForTenant(A.id, t1); await scheduleForTenant(A.id, t1); expect(await count()).toBe(1); // 24 h reminder, once
    const t2 = new Date(start.getTime() - 100 * 60_000); await scheduleForTenant(A.id, t2); await scheduleForTenant(A.id, t2); expect(await count()).toBe(2); // 2 h reminder, once
    const late = new Date(start.getTime() + 60_000); await scheduleForTenant(A.id, late); expect(await count()).toBe(2); // after the appointment: nothing
  });
  it("an appointment booked inside the window gets no extra reminder; the global runner covers every clinic", async () => {
    installStubs(); await settings(A, { emailEnabled: false, reminderOffsets: [1440] }); const p = await pat(A); const start = new Date(Date.now() + 20 * 3_600_000);
    const a = await db.appointment.create({ data: { tenantId: A.id, publicId: uniq("APT"), doctorUserId: A.doctorId, patientId: p.id, startsAt: start, endsAt: new Date(start.getTime() + 900_000), type: "OPD", source: "RECEPTION", status: "CONFIRMED" } });
    await runScheduler(); expect(await db.communicationMessage.count({ where: { entityId: a.id, eventType: "APPOINTMENT_REMINDER" } })).toBe(0);
  });
  it("follow-up reminders go out once per due date; overdue/invoice nudges are off unless enabled", async () => {
    installStubs(); await settings(A, { emailEnabled: false }); const p = await pat(A); const f = await createFollowUp(A.recep, { patientId: p.id, title: "Review", afterDays: 1 }) as { id: string };
    await scheduleForTenant(A.id); await scheduleForTenant(A.id); expect(await db.communicationMessage.count({ where: { tenantId: A.id, entityId: f.id, eventType: "FOLLOW_UP_REMINDER" } })).toBe(1);
    expect(await db.communicationMessage.count({ where: { tenantId: A.id, patientId: p.id, eventType: { in: ["FOLLOW_UP_OVERDUE", "INVOICE_DUE", "INVOICE_OVERDUE"] } } })).toBe(0);
  });
});

describe("RBAC, tenant isolation and secrets", () => {
  let pA: { id: string; phone: string }, mA: string, mB: string;
  beforeAll(async () => {
    installStubs(); await settings(A, { emailEnabled: false }); await settings(B, { emailEnabled: false });
    pA = await pat(A); const pB = await pat(B); await emit(A, pA.id); await emit(B, pB.id);
    mA = (await msgs(A, { patientId: pA.id }))[0].id; mB = (await msgs(B, { patientId: pB.id }))[0].id;
  });
  it("who can see and change what", async () => {
    for (const who of [A.admin, A.recep, A.doctor, A.accountant, A.lab]) expect(await code(listMessages(who))).toBe("ok");
    expect(await code(listMessages(A.nurse))).toBe("FORBIDDEN");
    expect(await code(saveCommSettings(A.recep, {}))).toBe("FORBIDDEN"); expect(await code(getCommSettingsView(A.nurse))).toBe("FORBIDDEN");
    for (const who of [A.recep, A.doctor, A.accountant, A.lab]) { expect(await code(createTemplate(who, { channel: "SMS", eventType: "APPOINTMENT_CONFIRMED", language: "en", name: "x", body: "x" }))).toBe("FORBIDDEN"); expect(await code(previewTemplate(who, { channel: "SMS", body: "x" }))).toBe("FORBIDDEN"); }
    expect(await code(resendMessage(A.doctor, mA))).toBe("FORBIDDEN"); expect(await code(resendMessage(A.accountant, mA))).toBe("FORBIDDEN");
  });
  it("roles only see the message groups they should", async () => {
    await emit(A, pA.id, { event: "INVOICE_CREATED", vars: { invoice_number: "INV-9" }, eventKey: uniq("i") }); await emit(A, pA.id, { event: "LAB_REPORT_RELEASED", eventKey: uniq("l") });
    const ev = async (c: Ctx) => [...new Set((await listMessages(c, {})).rows.map((r) => r.event))];
    expect(await ev(A.accountant)).toEqual(["INVOICE_CREATED"]); expect(await ev(A.lab)).toEqual(["LAB_REPORT_RELEASED"]); expect(await ev(A.doctor)).not.toContain("INVOICE_CREATED"); expect(await ev(A.recep)).toContain("INVOICE_CREATED");
    const inv = (await msgs(A, { eventType: "INVOICE_CREATED" }))[0].id; expect(await code(getMessage(A.lab, inv))).toBe("NOT_FOUND");
    expect((await getMessage(A.recep, mA)).preview).not.toBeNull(); expect((await getMessage(A.doctor, mA)).preview).toBeNull(); // text only for admin / reception
  });
  it("clinic B cannot see, open, resend, or read anything of clinic A (IDOR)", async () => {
    expect(await code(getMessage(B.admin, mA))).toBe("NOT_FOUND"); expect(await code(resendMessage(B.recep, mA))).toBe("NOT_FOUND");
    expect((await listMessages(B.admin, {})).rows.map((r) => r.id)).not.toContain(mA); expect((await listMessages(B.admin, { patientId: pA.id })).rows).toHaveLength(0);
    expect((await entityComms(B.recep, { patientId: pA.id })).rows).toHaveLength(0);
    const tA = await createTemplate(A.admin, { channel: "SMS", eventType: "APPOINTMENT_REMINDER", language: "en", name: "iso", body: "iso {{patient_name}}" });
    expect(await code(updateTemplate(B.admin, tA.id, { channel: "SMS", eventType: "APPOINTMENT_REMINDER", language: "en", name: "iso", body: "hacked" }))).toBe("NOT_FOUND"); expect(await code(setTemplateStatus(B.admin, tA.id, { status: "ACTIVE" }))).toBe("NOT_FOUND");
    expect((await listTemplates(B.admin)).templates.map((t) => t.id)).not.toContain(tA.id);
    await settings(A, { emailEnabled: false, senderName: "A-ONLY" }); expect((await getCommSettingsView(B.admin)).settings.senderName).not.toBe("A-ONLY");
    expect((await commStats(B.admin)).total).not.toBe((await commStats(A.admin)).total);
  });
  it("settings views never contain provider credentials", async () => {
    process.env.WHATSAPP_PROVIDER = "meta"; process.env.WHATSAPP_ACCESS_TOKEN = "SUPER-SECRET-TOKEN-VALUE"; process.env.SMS_API_KEY = "SUPER-SECRET-SMS-KEY";
    const blob = JSON.stringify([await getCommSettingsView(A.admin), await listTemplates(A.admin), await listMessages(A.admin), await platformCommOverview(ctxFor((await makeUser("SUPER_ADMIN", null)).user, "SUPER_ADMIN", null))]);
    expect(blob).not.toContain("SUPER-SECRET"); delete process.env.WHATSAPP_PROVIDER; delete process.env.WHATSAPP_ACCESS_TOKEN; delete process.env.SMS_API_KEY;
  });
  it("resend: authorised staff only, rebuilds through consent rules, capped, audited", async () => {
    const s = installStubs(); await settings(A, { emailEnabled: false }); await processDue({ tenantId: A.id, limit: 200 }); const p = await pat(A); await emit(A, p.id); s.sms.next = [{ ok: false, retryable: false, code: "HTTP_400", message: "no" }]; await processDue({ tenantId: A.id });
    const m = (await msgs(A, { patientId: p.id }))[0]; expect(m.status).toBe("FAILED");
    expect((await resendMessage(A.recep, m.id)).queued).toBe(1); expect(await db.auditLog.count({ where: { tenantId: A.id, action: "comm.message_resent", entityId: m.id } })).toBe(1);
    await db.patient.update({ where: { id: p.id }, data: { prefSms: "NOT_ALLOWED" } }); expect((await resendMessage(A.recep, m.id)).queued).toBe(0); // patient opted out meanwhile
    await db.patient.update({ where: { id: p.id }, data: { prefSms: "ALLOWED" } }); await resendMessage(A.recep, m.id); expect(await code(resendMessage(A.recep, m.id))).toBe("CONFLICT"); // max resends
    const sec = await emit(A, p.id, { event: "ACCOUNT_SECURITY_ALERT" }); void sec; const secRow = (await msgs(A, { patientId: p.id, eventType: "ACCOUNT_SECURITY_ALERT" }))[0]; expect(await code(resendMessage(A.recep, secRow.id))).toBe("FORBIDDEN"); // security messages are not resendable
  });
  it("preview uses synthetic data, never sends, and is validated", async () => {
    const s = installStubs(); const before = s.sms.calls.length + s.email.calls.length; const r = await previewTemplate(A.admin, { channel: "EMAIL", subject: "Hi {{patient_name}}", body: "Dear {{patient_name}}, appointment with {{doctor_name}} on {{appointment_date}} at {{appointment_time}}." });
    expect(r.body).toContain("Gurjeet"); expect(r.body).toContain("Dr. Example"); expect(r.html).toContain("<!doctype html>"); expect(r.problems).toEqual([]); expect(s.sms.calls.length + s.email.calls.length).toBe(before);
    expect((await previewTemplate(A.admin, { channel: "SMS", body: "{{nope}}" })).problems.join()).toMatch(/Unsupported/);
  });
  it("settings are validated (channels, offsets, fallback, quiet hours)", async () => {
    expect(await code(settings(A, { channelOrder: ["SMS", "SMS"] }))).toBe("VALIDATION_ERROR"); expect(await code(settings(A, { reminderOffsets: [7] }))).toBe("VALIDATION_ERROR");
    expect(await code(settings(A, { fallbackRules: { SMS: "SMS" } }))).toBe("VALIDATION_ERROR"); expect(await code(settings(A, { quietEnabled: true, quietStartMin: 60, quietEndMin: 60 }))).toBe("VALIDATION_ERROR");
    expect(await code(settings(A, { maxRetries: 99 }))).toBe("VALIDATION_ERROR"); await settings(A, { emailEnabled: false });
    expect(await db.auditLog.count({ where: { tenantId: A.id, action: "comm.settings_changed" } })).toBeGreaterThan(0);
  });
  it("platform monitoring is Super Admin only and aggregate-only", async () => {
    expect(await code(platformCommOverview(A.admin as never))).toBe("FORBIDDEN"); const sa = ctxFor((await makeUser("SUPER_ADMIN", null)).user, "SUPER_ADMIN", null);
    const o = await platformCommOverview(sa); expect(o.totals.total).toBeGreaterThan(0); expect(JSON.stringify(o)).not.toMatch(/\+91\d{10}|@comm\.test/);
  });
});

describe("patient side", () => {
  it("a patient sees only their own message history, with no text or provider detail", async () => {
    const s = installStubs(); await settings(A, { emailEnabled: false }); const p = await pat(A); const q = await pat(A); const acc = await makeAccount(A, p.id, p.phone); const accQ = await makeAccount(A, q.id, q.phone);
    await emit(A, p.id); await processDue({ tenantId: A.id }); void s;
    const ctxOf = async (id: string, accId: string) => { const acc2 = await db.patientAccount.findUniqueOrThrow({ where: { id: accId }, include: { user: true, patient: true } }); const b = ctxFor(acc2.user, "PATIENT", A.id); return { ...asTenant({ ...b, tenant: { ...b.tenant!, name: "Comm Clinic a", timezone: TZ } as never }), patientId: id, accountId: accId, patient: { id, code: acc2.patient.code, name: acc2.patient.name, preferredName: null } }; };
    const mine = await myCommunications(await ctxOf(p.id, acc)); const theirs = await myCommunications(await ctxOf(q.id, accQ));
    expect(mine.rows.length).toBeGreaterThan(0); expect(JSON.stringify(mine)).not.toMatch(/Dr\. Test|provider|stub|\+91/); expect(theirs.rows.filter((r) => r.label === "Appointment confirmed")).toHaveLength(0);
    expect(Object.keys(mine.rows[0]).sort()).toEqual(["at", "channel", "id", "label", "status"]);
  });
  it("preferences report REAL availability and store the message language", async () => {
    installStubs(); await settings(A, { emailEnabled: false }); const p = await pat(A); const acc = await makeAccount(A, p.id, p.phone);
    const a2 = await db.patientAccount.findUniqueOrThrow({ where: { id: acc }, include: { user: true, patient: true } }); const b = ctxFor(a2.user, "PATIENT", A.id);
    const ctx = { ...asTenant({ ...b, tenant: { ...b.tenant!, name: "Comm Clinic a", timezone: TZ } as never }), patientId: p.id, accountId: acc, patient: { id: p.id, code: a2.patient.code, name: a2.patient.name, preferredName: null } };
    const pr = await getPreferences(ctx); expect(pr.configured).toMatchObject({ sms: true, whatsapp: false, email: false }); expect(pr.note).toContain("SMS");
    expect((await savePreferences(ctx, { language: "hi" })).language).toBe("hi"); expect(await code(savePreferences(ctx, { language: "xx" }))).toBe("VALIDATION_ERROR");
    expect((await getPreferences(ctx)).categories).not.toHaveProperty("language");
  });
});
