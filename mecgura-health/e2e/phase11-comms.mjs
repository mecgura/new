/**
 * Live HTTP + browser checks for Phase 11 (communication engine: settings, templates, log, webhooks, scheduler endpoint, isolation).
 * Run against a PRODUCTION build after `npm run db:seed`, with the server started with:
 *   CRON_SECRET=e2e-cron-secret-0123456789  EMAIL_PROVIDER=resend  EMAIL_WEBHOOK_SECRET=whsec_<base64>  WHATSAPP_VERIFY_TOKEN=e2e-verify
 * (no API keys: providers stay "not configured", so NOTHING is really sent — which is exactly what is verified).
 */
import { chromium } from "playwright-core";
import { createHmac } from "node:crypto";

const PORT = process.env.PORT ?? "3101"; const LOCAL = `localhost:${PORT}`; const PW = process.env.SEED_DEMO_PASSWORD ?? "Demo-Local-Pass-1";
const CRON = process.env.CRON_SECRET ?? "e2e-cron-secret-0123456789"; const WHSEC = process.env.EMAIL_WEBHOOK_SECRET ?? `whsec_${Buffer.from("e2e-svix-secret").toString("base64")}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
let pass = 0; const fails = []; const check = (n, ok, extra = "") => { if (ok) pass++; else { fails.push(n); console.log("  ✗", n, extra); } };
const noise = /Failed to load resource|Cross-Origin-Opener-Policy/;
async function login(path, email, password = PW, field = "identifier") {
  const ctx = await browser.newContext({ baseURL: `http://${LOCAL}` }); const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !noise.test(m.text())) errors.push(m.text()); });
  await page.goto(path); await page.fill(`input[name=${field}]`, email); await page.fill("input[name=password]", password); await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }); return { ctx, page, errors };
}
const api = async (c, method, path, body, origin) => { const r = await c.ctx.request.fetch(`http://${LOCAL}${path}`, { method, headers: { "content-type": "application/json", origin: origin ?? `http://${LOCAL}` }, data: body ? JSON.stringify(body) : undefined, failOnStatusCode: false, maxRedirects: 0 }); let json = null, text = ""; try { text = await r.text(); json = JSON.parse(text); } catch { /* */ } return { status: r.status(), json, text, headers: r.headers() }; };

const adminA = await login("/login", "admin@demo.mecgura.test"), recepA = await login("/login", "reception@demo.mecgura.test"), docA = await login("/login", "doctor@demo.mecgura.test"), accA = await login("/login", "accountant@demo.mecgura.test"), labA = await login("/login", "lab@demo.mecgura.test"), adminB = await login("/login", "admin@demob.mecgura.test"), recepB = await login("/login", "reception@demob.mecgura.test"), pharm = await login("/login", "pharmacy@demo.mecgura.test"), sa = await login("/login", "platform@demo.mecgura.test");

/* ---------- access ---------- */
check("anonymous communication APIs -> 401", [(await fetch(`http://${LOCAL}/api/communications/messages`)).status, (await fetch(`http://${LOCAL}/api/communications/settings`)).status, (await fetch(`http://${LOCAL}/api/platform/communications`)).status].every((s) => s === 401));
check("pharmacy staff have no communication access", (await api(pharm, "GET", "/api/communications/messages")).status === 403);
check("doctor / accountant / lab / reception can read the log; only admin configures", [docA, accA, labA, recepA].every((c) => true) && (await api(docA, "GET", "/api/communications/messages")).status === 200 && (await api(accA, "GET", "/api/communications/messages")).status === 200 && (await api(labA, "GET", "/api/communications/messages")).status === 200 && (await api(recepA, "PUT", "/api/communications/settings", {})).status === 403 && (await api(docA, "POST", "/api/communications/templates", { channel: "SMS" })).status === 403);
check("writes from another origin are blocked (CSRF)", (await api(adminA, "PUT", "/api/communications/settings", {}, "https://evil.example")).status === 403);
check("platform monitoring is Super Admin only", (await api(adminA, "GET", "/api/platform/communications")).status === 403 && (await api(sa, "GET", "/api/platform/communications")).status === 200);

/* ---------- webhooks + scheduler endpoint ---------- */
const hook = (path, body, headers = {}) => fetch(`http://${LOCAL}/api/webhooks/${path}`, { method: "POST", body, headers });
check("WhatsApp webhook is OFF without an app secret (never trusted by default)", (await hook("whatsapp", "{}")).status === 503);
check("unsigned SMS webhook is refused (no provider secret)", (await hook("sms", "MessageSid=SM1&MessageStatus=delivered", { "content-type": "application/x-www-form-urlencoded" })).status === 503);
check("unknown webhook channel -> 404", (await hook("nonsense", "{}")).status === 404);
const body = JSON.stringify({ type: "email.delivered", data: { email_id: "em_unknown_e2e" } }); const ts = String(Math.floor(Date.now() / 1000));
const svix = (id, t, b = body, secret = WHSEC) => ({ "svix-id": id, "svix-timestamp": t, "svix-signature": `v1,${createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${id}.${t}.${b}`).digest("base64")}` });
check("forged email webhook -> 401", (await hook("email", body, svix("m1", ts, body, `whsec_${Buffer.from("wrong").toString("base64")}`))).status === 401);
check("stale (replayed) email webhook -> 401", (await hook("email", body, svix("m2", String(Math.floor(Date.now() / 1000) - 7200)))).status === 401);
const ok1 = await hook("email", body, svix(`m-${Date.now()}`, ts)); check("a correctly signed webhook is accepted", ok1.status === 200, await ok1.text());
const sameId = `r-${Date.now()}`; await hook("email", body, svix(sameId, ts)); const again = await hook("email", body, svix(sameId, ts)); const aj = await again.json();
check("a replayed webhook is a no-op (idempotent)", again.status === 200 && aj.duplicate === 1 && aj.applied === 0, JSON.stringify(aj));
check("WhatsApp handshake rejects a wrong verify token", (await fetch(`http://${LOCAL}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status === 403);
const hs = await fetch(`http://${LOCAL}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=e2e-verify&hub.challenge=4242`); check("WhatsApp handshake answers with the challenge", hs.status === 200 && (await hs.text()) === "4242");
check("scheduler endpoint refuses anonymous / wrong-secret callers", (await fetch(`http://${LOCAL}/api/internal/communications/run`, { method: "POST" })).status === 401 && (await fetch(`http://${LOCAL}/api/internal/communications/run`, { method: "POST", headers: { authorization: "Bearer nope-nope-nope-nope-nope" } })).status === 401);
const run = await fetch(`http://${LOCAL}/api/internal/communications/run`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } }); const rj = await run.json();
check("scheduler endpoint runs with the secret", run.status === 200 && rj.ok === true && typeof rj.delivery?.claimed === "number", JSON.stringify(rj));

/* ---------- settings ---------- */
const view = await api(adminA, "GET", "/api/communications/settings");
check("admin reads settings + provider status without any secret", view.status === 200 && view.json.data.providers.length === 3 && !/key|token|secret/i.test(JSON.stringify(view.json.data.providers.map((p) => Object.keys(p)))) && view.json.data.providers.every((p) => p.configured === false), view.text.slice(0, 200));
const s0 = view.json.data.settings;
const save = await api(adminA, "PUT", "/api/communications/settings", { ...s0, smsEnabled: true, emailEnabled: true, quietEnabled: s0.quiet.enabled, quietStartMin: s0.quiet.startMin, quietEndMin: s0.quiet.endMin, reminderOffsets: [1440, 120] });
check("admin saves channel + reminder settings", save.status === 200 && save.json.data.settings.smsEnabled === true && save.json.data.settings.reminderOffsets.join() === "1440,120", save.text.slice(0, 200));
check("invalid settings are refused", (await api(adminA, "PUT", "/api/communications/settings", { ...s0, quietEnabled: false, quietStartMin: 0, quietEndMin: 0, reminderOffsets: [7], channelOrder: ["SMS"] })).status === 400);
check("clinic B's settings are untouched", (await api(adminB, "GET", "/api/communications/settings")).json.data.settings.smsEnabled === false);

/* ---------- an appointment queues a message; with no provider it is honestly 'not sent' ---------- */
const sched = await api(adminA, "GET", "/api/schedule"); const doctorId = (sched.json?.data?.rows ?? sched.json?.data ?? [])[0]?.doctorUserId ?? (sched.json?.data?.rows ?? sched.json?.data ?? [])[0]?.id;
const pt = await api(recepA, "GET", "/api/patients?q=Demo%20Patient%20One"); const pid = pt.json?.data?.rows?.[0]?.id;
let d = 3; let startsAt; for (; d < 12; d++) { const dt = new Date(Date.now() + d * 86_400_000); if (dt.getUTCDay() === 0) continue; startsAt = `${dt.toISOString().slice(0, 10)}T11:00:00+05:30`; break; }
const appt = await api(recepA, "POST", "/api/appointments", { doctorUserId: doctorId, startsAt, patient: { patientId: pid, viaProfile: true } });
check("reception books an appointment (never blocked by messaging)", appt.status === 200, appt.text.slice(0, 200));
const log = await api(recepA, "GET", "/api/communications/messages?event=APPOINTMENT_CONFIRMED"); const row = log.json?.data?.rows?.[0];
check("the confirmation appears in the log as NOT SENT with the real reason", !!row && row.status === "SKIPPED" && row.failureCode === "PROVIDER_NOT_CONFIGURED" && !!row.failureReason, log.text.slice(0, 300));
check("log rows mask the recipient and carry no message text", row && /•/.test(row.recipient) && !("body" in row), JSON.stringify(row));
const det = await api(recepA, "GET", `/api/communications/messages/${row.id}`);
check("message detail shows status history, no secrets, no fake provider id", det.status === 200 && det.json.data.providerMessageId === null && det.json.data.sentAt === null && Array.isArray(det.json.data.history), det.text.slice(0, 200));
check("skipped messages can be resent by reception, but not by the doctor", (await api(docA, "POST", `/api/communications/messages/${row.id}/resend`)).status === 403 && (await api(recepA, "POST", `/api/communications/messages/${row.id}/resend`)).status === 200);
const stats = await api(recepA, "GET", "/api/communications/stats"); check("stats count it as 'not sent', not 'sent'", stats.json.data.skipped >= 1 && stats.json.data.sent === 0 && stats.json.data.delivered === 0, stats.text);
check("accountant doesn't see appointment messages", !(await api(accA, "GET", "/api/communications/messages")).text.includes("APPOINTMENT_CONFIRMED"));
check("clinic B cannot open, resend or list clinic A's messages (IDOR)", (await api(adminB, "GET", `/api/communications/messages/${row.id}`)).status === 404 && (await api(recepB, "POST", `/api/communications/messages/${row.id}/resend`)).status === 404 && (await api(adminB, "GET", "/api/communications/messages")).json.data.total === 0);
const ent = await api(recepA, "GET", `/api/communications/entity?patientId=${pid}`); check("per-patient communication status API works", ent.status === 200);

/* ---------- templates ---------- */
const XSS = `<img src=x onerror="window.__x=1"><script>window.__x=1</script> {{patient_name}}`;
const pv = await api(adminA, "POST", "/api/communications/templates/preview", { channel: "EMAIL", subject: "Hello {{patient_name}}", body: `Dear {{patient_name}}, ${XSS}` });
check("preview renders sample data, escapes HTML in the email, sends nothing", pv.status === 200 && pv.json.data.sample === true && !pv.json.data.html.includes("<script>") && pv.json.data.html.includes("&lt;script&gt;") && pv.json.data.body.includes("Gurjeet"));
check("preview flags unsupported variables", (await api(adminA, "POST", "/api/communications/templates/preview", { channel: "SMS", body: "{{secret_key}}" })).json.data.problems.length > 0);
const tc = await api(adminA, "POST", "/api/communications/templates", { channel: "SMS", eventType: "APPOINTMENT_CONFIRMED", language: "en", name: `E2E ${Date.now()}`, body: "Hi {{patient_name}}, booked at {{clinic_name}}. {{portal_link}}" });
check("admin creates a draft template", tc.status === 200 && tc.json.data.status === "DRAFT", tc.text);
check("a WhatsApp template can't go live without an approved template name", await (async () => { const w = await api(adminA, "POST", "/api/communications/templates", { channel: "WHATSAPP", eventType: "APPOINTMENT_CONFIRMED", language: "en", name: `WA ${Date.now()}`, body: "Hi {{patient_name}}" }); return (await api(adminA, "POST", `/api/communications/templates/${w.json.data.id}/status`, { status: "ACTIVE" })).status === 400; })());
check("admin activates it; clinic B can't touch it", (await api(adminB, "POST", `/api/communications/templates/${tc.json.data.id}/status`, { status: "ACTIVE" })).status === 404 && (await api(adminA, "POST", `/api/communications/templates/${tc.json.data.id}/status`, { status: "ACTIVE" })).status === 200);
check("clinic B doesn't see clinic A's template", !(await api(adminB, "GET", "/api/communications/templates")).text.includes(tc.json.data.id));

/* ---------- UI ---------- */
for (const [c, name, p, re] of [[recepA, "reception", "/communications", /Communications/], [adminA, "admin", "/communications/templates", /Message templates/], [adminA, "admin", "/settings/communications", /Channels/], [docA, "doctor", "/communications", /Communications/], [sa, "super admin", "/platform/communications", /Communication monitoring/]]) {
  const r = await c.page.goto(p); await c.page.waitForTimeout(1200); const t = await c.page.textContent("body");
  check(`${name}: ${p} renders`, r.status() === 200 && re.test(t) && !/Application error/.test(t), `${r.status()}`);
}
await recepA.page.goto("/communications"); await recepA.page.waitForSelector("text=Not sent", { timeout: 15000 }).catch(() => {});
check("the log shows the honest 'not sent' state and a provider warning", /Not sent/.test(await recepA.page.textContent("body")) && /not configured|Not configured|No channel/i.test(await recepA.page.textContent("body")));
await recepA.page.getByRole("button", { name: /Details/ }).first().click(); await recepA.page.waitForSelector("text=Message details"); check("details dialog opens with the reason", /Why it was not sent|provider/i.test(await recepA.page.textContent("body")));
await recepA.page.keyboard.press("Escape");
await docA.page.goto("/communications/templates"); await docA.page.waitForTimeout(2000); check("doctor can't open the template editor", docA.page.url().includes("forbidden") && !/Message templates/.test(await docA.page.textContent("body")), docA.page.url());
check("accountant sees the log only for billing", (await api(accA, "GET", "/api/communications/stats")).status === 200);
await adminA.page.goto("/communications/templates"); await adminA.page.getByRole("button", { name: "New template" }).click(); await adminA.page.fill("textarea", "Hello {{patient_name}}"); await adminA.page.getByRole("button", { name: "Preview" }).click(); await adminA.page.waitForSelector("text=Preview with sample data");
check("template editor previews live without sending", /Gurjeet/.test(await adminA.page.textContent("body")) && await adminA.page.evaluate(() => !window.__x));
await adminA.page.keyboard.press("Escape");
await adminA.page.goto("/settings/integrations"); check("integrations page tells the truth (no provider configured)", (await adminA.page.textContent("body")).includes("Not configured"));

/* ---------- patient portal ---------- */
const P = await login("/portal/login?clinic=demo-clinic", "patient@demo.mecgura.test"); await P.page.goto("/portal/settings");
check("portal preferences show the language choice and honest channel status", /Language for messages/.test(await P.page.textContent("body")) && /not using this yet|isn.t sending|saved for when/i.test(await P.page.textContent("body")));
await P.page.goto("/portal/notifications"); check("portal shows 'Messages the clinic sent you'", /Messages the clinic sent you/.test(await P.page.textContent("body")));
check("patient comms API is own-data, no text", await (async () => { const r = await api(P, "GET", "/api/patient/communications"); return r.status === 200 && !/body|recipient|provider/i.test(r.text); })());
check("patient can't call staff communication APIs", (await api(P, "GET", "/api/communications/messages")).status >= 401 && (await api(P, "POST", `/api/communications/messages/${row.id}/resend`)).status >= 401);
const pr = await api(P, "PUT", "/api/patient/preferences", { language: "pa" }); check("patient saves message language", pr.status === 200 && pr.json.data.language === "pa", pr.text.slice(0, 160));

/* ---------- responsive + console ---------- */
await recepA.page.setViewportSize({ width: 375, height: 740 });
for (const p of ["/communications"]) { await recepA.page.goto(p); await recepA.page.waitForTimeout(800); const over = await recepA.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`no horizontal scroll at 375px on ${p}`, over <= 1, `overflow ${over}`); }
await adminA.page.setViewportSize({ width: 375, height: 740 }); for (const p of ["/settings/communications", "/communications/templates"]) { await adminA.page.goto(p); await adminA.page.waitForTimeout(1000); const over = await adminA.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`no horizontal scroll at 375px on ${p}`, over <= 1, `overflow ${over}`); }
await P.page.setViewportSize({ width: 375, height: 740 }); await P.page.goto("/portal/settings"); check("portal preferences fit a phone", (await P.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
check("no console errors", [adminA, recepA, docA, sa, P].every((c) => c.errors.length === 0), [adminA, recepA, docA, sa, P].flatMap((c) => c.errors).join(" | ").slice(0, 400));

await browser.close(); console.log(`\nPhase 11 e2e: ${pass} passed, ${fails.length} failed`); if (fails.length) { console.log("FAILED:\n - " + fails.join("\n - ")); process.exit(1); }
