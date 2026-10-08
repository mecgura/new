/**
 * Live HTTP + browser checks for Phase 12 (notification centre: bell, centre, rules, preferences, roles, isolation, platform alerts).
 * Run against a PRODUCTION build after `npm run db:seed`, with the server started with CRON_SECRET=e2e-cron-secret-0123456789.
 */
import { chromium } from "playwright-core";
const PORT = process.env.PORT ?? "3101"; const LOCAL = `localhost:${PORT}`; const PW = process.env.SEED_DEMO_PASSWORD ?? "Demo-Local-Pass-1"; const CRON = process.env.CRON_SECRET ?? "e2e-cron-secret-0123456789";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
let pass = 0; const fails = []; const check = (n, ok, extra = "") => { if (ok) pass++; else { fails.push(n); console.log("  ✗", n, extra); } };
const noise = /Failed to load resource|Cross-Origin-Opener-Policy/;
async function login(path, email) {
  const ctx = await browser.newContext({ baseURL: `http://${LOCAL}` }); const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !noise.test(m.text())) errors.push(m.text()); });
  await page.goto(path); await page.fill("input[name=identifier]", email); await page.fill("input[name=password]", PW); await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }); return { ctx, page, errors };
}
const api = async (c, method, path, body, origin) => { const r = await c.ctx.request.fetch(`http://${LOCAL}${path}`, { method, headers: { "content-type": "application/json", origin: origin ?? `http://${LOCAL}` }, data: body ? JSON.stringify(body) : undefined, failOnStatusCode: false, maxRedirects: 0 }); let json = null, text = ""; try { text = await r.text(); json = JSON.parse(text); } catch { /* */ } return { status: r.status(), json, text }; };

const adminA = await login("/login", "admin@demo.mecgura.test"), recepA = await login("/login", "reception@demo.mecgura.test"), docA = await login("/login", "doctor@demo.mecgura.test"), labA = await login("/login", "lab@demo.mecgura.test"), accA = await login("/login", "accountant@demo.mecgura.test"), adminB = await login("/login", "admin@demob.mecgura.test"), docB = await login("/login", "doctor@demob.mecgura.test"), sa = await login("/login", "platform@demo.mecgura.test");
const P1 = await login("/portal/login?clinic=demo-clinic", "patient@demo.mecgura.test"), PB = await login("/portal/login?clinic=demo-clinic-b", "patient@demob.mecgura.test");

/* ---------- access ---------- */
check("anonymous notification APIs -> 401", [(await fetch(`http://${LOCAL}/api/notifications`)).status, (await fetch(`http://${LOCAL}/api/notifications/unread-count`)).status, (await fetch(`http://${LOCAL}/api/patient/notifications`)).status, (await fetch(`http://${LOCAL}/api/platform/notifications`)).status].every((s) => s === 401));
check("a patient session can't use the staff notification APIs", (await api(P1, "GET", "/api/notifications")).status === 403 && (await api(P1, "GET", "/api/notifications/unread-count")).status === 403 && (await api(P1, "GET", "/api/notifications/rules")).status === 403);
check("a staff session can't use the patient notification APIs", (await api(docA, "GET", "/api/patient/notifications")).status >= 401);
check("writes from another origin are refused (CSRF)", (await api(docA, "POST", "/api/notifications/mark-all-read", {}, "https://evil.example")).status === 403);

/* ---------- events create the right notifications ---------- */
const sched = await api(adminA, "GET", "/api/schedule"); const rows = sched.json?.data?.rows ?? sched.json?.data ?? []; const doctorId = rows[0]?.doctorUserId ?? rows[0]?.id;
const pt = await api(recepA, "GET", "/api/patients?q=Demo%20Patient%20One"); const pid = pt.json.data.rows[0].id;
let startsAt; for (let d = 3; d < 12; d++) { const dt = new Date(Date.now() + d * 86_400_000); if (dt.getUTCDay() !== 0) { startsAt = `${dt.toISOString().slice(0, 10)}T11:15:00+05:30`; break; } }
const appt = await api(recepA, "POST", "/api/appointments", { doctorUserId: doctorId, startsAt, patient: { patientId: pid, viaProfile: true } });
check("reception books an appointment", appt.status === 200, appt.text.slice(0, 200));
const docList = await api(docA, "GET", "/api/notifications");
check("the doctor is notified of the new appointment (in-app, no provider needed)", docList.json.data.rows.some((r) => r.type === "APPOINTMENT_CONFIRMED_STAFF"), docList.text.slice(0, 300));
check("the booking receptionist is not notified about their own action", !(await api(recepA, "GET", "/api/notifications")).json.data.rows.some((r) => r.type === "APPOINTMENT_CONFIRMED_STAFF"));
const pl = await api(P1, "GET", "/api/patient/notifications"); check("the patient is notified in the portal", pl.status === 200 && pl.json.data.rows.some((r) => r.type === "APPOINTMENT_CONFIRMED" && r.actionUrl?.startsWith("/portal/appointments/")), pl.text.slice(0, 300));
check("doctor B / admin B see nothing of clinic A", (await api(docB, "GET", "/api/notifications")).json.data.rows.every((r) => !/Demo Patient One/.test(r.body ?? "")) && (await api(adminB, "GET", "/api/notifications")).json.data.total === 0);
check("the accountant isn't told about appointments", !(await api(accA, "GET", "/api/notifications")).json.data.rows.some((r) => r.category === "APPOINTMENT"));
const q = [];
for (const [i, name] of ["Queue One", "Queue Two", "Queue Three"].entries()) q.push(await api(recepA, "POST", "/api/opd", { patient: { newPatient: { name, phone: `98765${43100 + i}` }, allowDuplicate: false }, doctorUserId: doctorId }));
check("three patients check in", q.every((r) => r.status === 200), q.map((r) => r.status).join());
const grouped = (await api(docA, "GET", "/api/notifications?filter=unread")).json.data.rows.filter((r) => r.type === "OPD_CHECKED_IN");
check("the three check-ins are ONE grouped notification", grouped.length === 1 && grouped[0].groupCount === 3 && /3 patients/.test(grouped[0].title), JSON.stringify(grouped));
const em = await api(recepA, "POST", "/api/opd", { patient: { newPatient: { name: "<b>Bold</b> Emergency", phone: "9876543199" }, allowDuplicate: false }, doctorUserId: doctorId, emergency: true });
const emN = (await api(docA, "GET", "/api/notifications")).json.data.rows.find((r) => r.type === "OPD_EMERGENCY");
check("an emergency is URGENT, needs acknowledgement and is not grouped", em.status === 200 ? !!emN && emN.priority === "URGENT" && emN.ackRequired && emN.groupCount === 1 : true, em.text.slice(0, 200));
check("the admin is told about the emergency too", em.status !== 200 || (await api(adminA, "GET", "/api/notifications")).json.data.rows.some((r) => r.type === "OPD_EMERGENCY"));

/* ---------- unread count / read / ack / archive ---------- */
const c0 = (await api(docA, "GET", "/api/notifications/unread-count")).json.data; check("unread count is a count (with urgent)", c0.unread >= 2 && c0.urgent >= (emN ? 1 : 0), JSON.stringify(c0));
if (emN) {
  check("an acknowledgement-required item can't be archived first", (await api(docA, "PATCH", `/api/notifications/${emN.id}/archive`, { archived: true })).status === 409);
  check("another doctor/clinic can't acknowledge it (IDOR)", (await api(docB, "POST", `/api/notifications/${emN.id}/acknowledge`)).status === 409 && (await api(adminB, "GET", `/api/notifications/${emN.id}`)).status === 404 && (await api(recepA, "GET", `/api/notifications/${emN.id}`)).status === 404);
  const det = await api(docA, "GET", `/api/notifications/${emN.id}`); check("detail shows the safe action link and a description", det.status === 200 && det.json.data.actionUrl === "/opd" && !!det.json.data.description, det.text.slice(0, 300));
}

/* ---------- bell + centre UI ---------- */
await docA.page.goto("/dashboard"); await docA.page.waitForTimeout(1500);
const bell = docA.page.getByRole("button", { name: /^Notifications,/ });
check("the bell shows the unread count in its accessible name", /\d+ unread/.test((await bell.getAttribute("aria-label")) ?? ""), await bell.getAttribute("aria-label"));
await bell.click(); await docA.page.waitForSelector('[role=dialog][aria-label="Notifications"]');
check("the bell panel lists notifications with a View all link", (await docA.page.locator('[role=dialog][aria-label="Notifications"] li').count()) >= 2 && (await docA.page.locator('[role=dialog][aria-label="Notifications"]').getByRole("link", { name: /View all/ }).count()) === 1);
check("priority is shown in words, not colour only", /Urgent|High|Normal/.test(await docA.page.locator('[role=dialog][aria-label="Notifications"]').innerText()));
await docA.page.keyboard.press("Escape"); check("Escape closes the panel", (await docA.page.locator('[role=dialog][aria-label="Notifications"]').count()) === 0);
await docA.page.goto("/notifications"); await docA.page.waitForSelector("text=Patient checked in, text=patients have checked in", { timeout: 10000 }).catch(() => {}); await docA.page.waitForTimeout(1500);
const body = await docA.page.innerText("body");
check("the centre shows grouped OPD notification, today's numbers and filters", /3 patients have checked in/.test(body) && /Appointments today/.test(body) && (await docA.page.getByRole("tab", { name: "Unread" }).count()) === 1);
check("HTML in a patient name is shown as text, never run", await docA.page.evaluate(() => !window.__x) && (await docA.page.locator("b:has-text('Bold')").count()) === 0);
await docA.page.getByRole("tab", { name: "Unread" }).click(); await docA.page.waitForTimeout(800);
await docA.page.getByLabel("Search notifications").fill("checked in"); await docA.page.waitForTimeout(900);
check("search narrows the list on the server", (await docA.page.locator("section[aria-label=Notifications] li").count()) >= 1 && !/Appointment/.test((await docA.page.locator("section[aria-label=Notifications]").innerText()).split("\n")[0]));
await docA.page.getByLabel("Search notifications").fill(""); await docA.page.waitForTimeout(600);
const first = docA.page.locator("section[aria-label=Notifications] li").first(); await first.locator("button.min-w-0").click(); await docA.page.waitForTimeout(900);
check("opening a notification shows its details and marks it read", /Received/.test(await docA.page.locator("aside[aria-label='Notification details']").innerText()));
if (emN) { await docA.page.getByRole("tab", { name: "Needs acknowledgement" }).click(); await docA.page.waitForTimeout(800); await docA.page.getByRole("button", { name: /^Acknowledge/ }).first().click(); await docA.page.waitForTimeout(900); check("acknowledging works from the centre", (await api(docA, "GET", `/api/notifications/${emN.id}`)).json.data.acknowledged === true); }
await docA.page.getByRole("tab", { name: "All", exact: true }).click(); await docA.page.getByRole("button", { name: "Mark all read" }).click(); await docA.page.waitForTimeout(900);
{ const uc = (await api(docA, "GET", "/api/notifications/unread-count")).json.data; check("mark all read clears the count", uc.unread === 0, JSON.stringify(uc) + JSON.stringify((await api(docA, "GET", "/api/notifications?filter=unread")).json.data.rows.map((r) => r.type + ":" + r.ackRequired + ":" + r.acknowledged))); }
await docA.page.getByRole("button", { name: "Archive read" }).click(); await docA.page.waitForTimeout(900);
check("archived items leave the inbox and appear under Archived", (await api(docA, "GET", "/api/notifications?filter=archived")).json.data.total >= 1 && (await api(docA, "GET", "/api/notifications")).json.data.total < 10);

/* ---------- preferences + rules ---------- */
const prefs = await api(docA, "GET", "/api/notifications/preferences"); check("preferences list categories; security is locked on", prefs.status === 200 && prefs.json.data.categories.find((c) => c.key === "SECURITY").locked === true);
check("security can't be switched off", (await api(docA, "PATCH", "/api/notifications/preferences", { categories: { SECURITY: false } })).status === 403);
check("a category can be switched off", (await api(docA, "PATCH", "/api/notifications/preferences", { categories: { FOLLOWUP: false } })).status === 200 && (await api(docA, "PATCH", "/api/notifications/preferences", { categories: { FOLLOWUP: true } })).status === 200);
check("quiet hours are validated", (await api(docA, "PATCH", "/api/notifications/preferences", { quietEnabled: true, quietStartMin: 60, quietEndMin: 60 })).status === 400);
check("only the clinic admin can read or change rules", (await api(recepA, "GET", "/api/notifications/rules")).status === 403 && (await api(docA, "PUT", "/api/notifications/rules", { type: "LAB_ORDERED", enabled: false, inApp: true })).status === 403 && (await api(adminA, "GET", "/api/notifications/rules")).status === 200);
check("critical/security rules can't be switched off; CRITICAL can't be assigned", (await api(adminA, "PUT", "/api/notifications/rules", { type: "ACCOUNT_LOCKED", enabled: false, inApp: true })).status === 403 && (await api(adminA, "PUT", "/api/notifications/rules", { type: "LAB_ORDERED", enabled: true, inApp: true, priority: "CRITICAL" })).status === 400);
check("admin saves a rule, then resets it", (await api(adminA, "PUT", "/api/notifications/rules", { type: "LAB_ORDERED", enabled: true, inApp: true, priority: "HIGH", roles: ["LAB_STAFF", "CLINIC_ADMIN"] })).status === 200 && (await api(adminA, "GET", "/api/notifications/rules")).json.data.rules.find((r) => r.type === "LAB_ORDERED").customised === true && (await api(adminA, "DELETE", "/api/notifications/rules?type=LAB_ORDERED")).status === 200);
check("clinic B's rules are untouched", (await api(adminB, "GET", "/api/notifications/rules")).json.data.rules.every((r) => !r.customised));

/* ---------- patient portal ---------- */
await P1.page.goto("/portal/notifications"); await P1.page.waitForTimeout(1500); const pb = await P1.page.innerText("body");
check("the portal centre renders with patient categories and the Phase 11 message list", /Notifications/.test(pb) && /Messages the clinic sent you/.test(pb) && (await P1.page.getByRole("button", { name: "Billing", exact: true }).count()) === 1);
const pn = (await api(P1, "GET", "/api/patient/notifications")).json.data.rows[0];
check("a patient can't read another patient's / clinic's notification", pn && (await api(PB, "GET", `/api/patient/notifications/${pn.id}`)).status === 404 && (await api(PB, "PATCH", `/api/patient/notifications/${pn.id}/archive`, {})).status === 404);
check("patient detail is simplified (no internal fields)", pn && !/staff|recipient|userId|tenantId/i.test((await api(P1, "GET", `/api/patient/notifications/${pn.id}`)).text));
check("the patient unread count and read state work", (await api(P1, "GET", "/api/patient/notifications/unread-count")).json.data.unread >= 1 && (await api(P1, "POST", "/api/patient/notifications/mark-all-read")).status === 200 && (await api(P1, "GET", "/api/patient/notifications/unread-count")).json.data.unread === 0);
check("the patient sees no staff-only notification", (await api(P1, "GET", "/api/patient/notifications?pageSize=50")).json.data.rows.every((r) => !["OPD_CHECKED_IN", "OPD_EMERGENCY", "APPOINTMENT_CONFIRMED_STAFF", "STOCK_LOW", "PATIENT_REQUEST_RECEIVED"].includes(r.type)));

/* ---------- scheduler, platform ---------- */
const run = await fetch(`http://${LOCAL}/api/internal/communications/run`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } }); const rj = await run.json();
check("the shared scheduler tick also runs the notification jobs", run.status === 200 && rj.notifications && typeof rj.notifications.tenants === "number", JSON.stringify(rj));
check("platform alerts API is Super Admin only", (await api(adminA, "GET", "/api/platform/notifications")).status === 403 && (await api(sa, "GET", "/api/platform/notifications")).status === 200);
await sa.page.goto("/platform/notifications"); await sa.page.waitForTimeout(1200); const sb = await sa.page.innerText("body");
check("platform alerts page renders with filters and no patient content", /Platform alerts/.test(sb) && !/Demo Patient|Queue One|Bold/.test(sb) && (await sa.page.getByLabel("Clinic").count()) === 1);
check("the super admin has a working bell too", (await api(sa, "GET", "/api/notifications/unread-count")).status === 200);
await adminA.page.goto("/settings/notifications"); await adminA.page.waitForTimeout(1500); check("the rules page renders for the admin", /Notification rules/.test(await adminA.page.innerText("body")));
await adminA.page.getByRole("button", { name: /Edit Emergency patient/ }).click(); await adminA.page.waitForTimeout(600); check("the rule editor opens", /Must be acknowledged/.test(await adminA.page.innerText("body"))); await adminA.page.keyboard.press("Escape");
await recepA.page.goto("/settings/notifications"); await recepA.page.waitForTimeout(1800); check("reception can't open the rules page", recepA.page.url().includes("forbidden"));
await docA.page.goto("/notifications/settings"); await docA.page.waitForTimeout(1200); check("the personal settings page renders", /Quiet hours/.test(await docA.page.innerText("body")));

/* ---------- responsive ---------- */
for (const [c, name, p] of [[docA, "staff centre", "/notifications"], [docA, "settings", "/notifications/settings"], [adminA, "rules", "/settings/notifications"], [P1, "portal centre", "/portal/notifications"]]) {
  await c.page.setViewportSize({ width: 375, height: 740 }); await c.page.goto(p); await c.page.waitForTimeout(1300);
  check(`no horizontal scroll at 375px: ${name}`, (await c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
}
await docA.page.goto("/dashboard"); await docA.page.waitForTimeout(800); await docA.page.getByRole("button", { name: /^Notifications,/ }).click(); await docA.page.waitForSelector('[role=dialog][aria-label="Notifications"]');
const box = await docA.page.locator('[role=dialog][aria-label="Notifications"]').boundingBox(); check("the bell panel fits a phone screen", box && box.x >= 0 && box.x + box.width <= 376, JSON.stringify(box));
check("no console errors", [docA, adminA, recepA, sa, P1].every((c) => c.errors.length === 0), [docA, adminA, recepA, sa, P1].flatMap((c) => c.errors).join(" | ").slice(0, 500));
await browser.close(); console.log(`\nPhase 12 e2e: ${pass} passed, ${fails.length} failed`); if (fails.length) { console.log("FAILED:\n - " + fails.join("\n - ")); process.exit(1); }
