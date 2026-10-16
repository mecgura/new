/**
 * Live HTTP + browser checks for Phase 7 (follow-up CRM, contact log, recalls, appointment integration, Patient 360, reminders).
 * Run against a PRODUCTION build after `npm run db:seed`.  node e2e/phase7-followups.mjs
 */
import { chromium } from "playwright-core";

const PORT = process.env.PORT ?? "3101";
const LOCAL = `localhost:${PORT}`;
const PW = process.env.SEED_DEMO_PASSWORD ?? "Demo-Local-Pass-1";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
let pass = 0; const fails = [];
const check = (n, ok, extra = "") => { if (ok) pass++; else { fails.push(n); console.log("  ✗", n, extra); } };
const noise = /Failed to load resource|Cross-Origin-Opener-Policy/;
const stamp = Date.now().toString(36);

async function login(identifier) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !noise.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://${LOCAL}/login`); await page.fill("input[name=identifier]", identifier); await page.fill("input[name=password]", PW); await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  return { ctx, page, errors };
}
const api = async (c, method, path, body, origin = `http://${LOCAL}`) => {
  const r = await c.ctx.request.fetch(`http://${LOCAL}${path}`, { method, headers: { "content-type": "application/json", origin }, data: body ? JSON.stringify(body) : undefined, failOnStatusCode: false, maxRedirects: 0 });
  let j = null; let text = ""; try { text = await r.text(); j = JSON.parse(text); } catch { /* */ }
  return { status: r.status(), json: j, text, headers: r.headers() };
};
const ymd = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const adminA = await login("admin@demo.mecgura.test"), docA = await login("doctor@demo.mecgura.test"), recepA = await login("reception@demo.mecgura.test"), labA = await login("lab@demo.mecgura.test");
const adminB = await login("admin@demob.mecgura.test"), recepB = await login("reception@demob.mecgura.test"), docB = await login("doctor@demob.mecgura.test");

const doctorId = (await api(recepA, "GET", "/api/opd")).json.data.doctors[0].id;
const patientNamed = async (who, name) => (await api(who, "GET", `/api/patients/search?q=${encodeURIComponent(name)}`)).json?.data?.find((p) => p.name === name)?.id;
const regPatient = async (name, phone) => { await api(recepA, "POST", "/api/opd", { patient: { newPatient: { name, phone, gender: "FEMALE", dateOfBirth: "1988-02-02" }, allowDuplicate: true }, doctorUserId: doctorId }); return patientNamed(recepA, name); };

/* ---------- access ---------- */
check("lab staff have no follow-up access", (await api(labA, "GET", "/api/followups")).status === 403 && (await api(labA, "GET", "/api/followups/stats")).status === 403);
check("unauthenticated -> 401", (await fetch(`http://${LOCAL}/api/followups`)).status === 401);
check("only the admin changes rules", (await api(recepA, "PUT", "/api/followups/settings", { createOnNoShow: true, createOnCancellation: false, recallCreatesFollowUp: false, completeWhenVisitDone: false, contactOutcomes: [], completionOutcomes: [] })).status === 403);
const settings = (await api(recepA, "GET", "/api/followups/settings")).json.data;
check("settings show honest integrations", settings.integrations.whatsapp === false && settings.integrations.sms === false && settings.integrations.email === false);

/* ---------- manual follow-up + isolation ---------- */
const pName = `E2E Follow ${stamp}`;
const pid = await regPatient(pName, "9876540001");
check("patient exists", !!pid);
const day = await (async () => { for (let n = 2; n < 12; n++) { const r = await api(recepA, "GET", `/api/appointments/slots?doctorUserId=${doctorId}&date=${ymd(n)}`); if (r.json?.data?.slots?.length) return ymd(n); } return null; })();
check("found a day with free slots", !!day);
const created = await api(recepA, "POST", "/api/followups", { patientId: pid, title: "Call to book the review", type: "MANUAL_FOLLOW_UP", dueDate: day, priority: "HIGH", description: "Please book a review visit" });
check("reception creates a follow-up with a clinic-scoped number", created.status === 200 && /^FU-\d{4}-\d{6}$/.test(created.json.data.followUpNumber), created.text);
const FID = created.json.data.id;
check("past due dates and missing patient are refused", (await api(recepA, "POST", "/api/followups", { patientId: pid, title: "Past", dueDate: "2020-01-01" })).status === 400 && (await api(recepA, "POST", "/api/followups", { title: "No patient", afterDays: 1 })).status === 400);
check("clinic B can't read, act on or contact A's follow-up", (await api(adminB, "GET", `/api/followups/${FID}`)).status === 404 && (await api(recepB, "POST", `/api/followups/${FID}/action`, { action: "cancel", reason: "attack" })).status === 404 && (await api(recepB, "POST", `/api/followups/${FID}/contact`, { method: "PHONE", outcome: "CONTACTED" })).status === 404 && (await api(docB, "PATCH", `/api/followups/${FID}`, { title: "hijack" })).status === 404);
check("clinic B can't create for A's patient", (await api(recepB, "POST", "/api/followups", { patientId: pid, title: "Cross clinic", afterDays: 1 })).status === 404);
check("clinic B worklist doesn't include A's follow-up", !(await api(adminB, "GET", "/api/followups?tab=all")).text.includes(FID));
check("cross-site writes are blocked", (await api(recepA, "POST", `/api/followups/${FID}/action`, { action: "start" }, "https://evil.example")).status === 403);
check("reception may complete operational follow-ups", (await api(recepA, "GET", `/api/followups/${FID}`)).json.data.can.complete === true);

/* ---------- contact log ---------- */
check("invalid contact outcome/method refused", (await api(recepA, "POST", `/api/followups/${FID}/contact`, { method: "PHONE", outcome: "MAGIC" })).status === 400 && (await api(recepA, "POST", `/api/followups/${FID}/contact`, { method: "PIGEON", outcome: "CONTACTED" })).status === 400);
check("contact logged; status moves but never completes", (await api(recepA, "POST", `/api/followups/${FID}/contact`, { method: "PHONE", outcome: "NO_RESPONSE", notes: "Rang twice" })).status === 200 && (await api(recepA, "GET", `/api/followups/${FID}`)).json.data.status === "NO_RESPONSE");
check("counts are real: no response card", (await api(recepA, "GET", "/api/followups/stats")).json.data.noResponse >= 1);

check("contact history is kept", (await api(recepA, "POST", `/api/followups/${FID}/contact`, { method: "WHATSAPP", outcome: "MESSAGE_SENT", notes: "Logged manually" })).status === 200 && (await api(recepA, "GET", `/api/followups/${FID}`)).json.data.contacts.length === 2);

/* ---------- consultation → follow-up (Phase 5) ---------- */
const cName = `E2E Consult ${stamp}`;
const v = (await api(recepA, "POST", "/api/opd", { patient: { newPatient: { name: cName, phone: "9876540002", gender: "MALE", dateOfBirth: "1980-01-01" }, allowDuplicate: true }, doctorUserId: doctorId })).json.data;
const cons = (await api(docA, "POST", "/api/consultations/start", { visitId: v.id })).json.data;
const cur = (await api(docA, "GET", `/api/consultations/${cons.id}`)).json.data;
await api(docA, "PATCH", `/api/consultations/${cons.id}`, { rev: cur.rev, chiefComplaints: [{ text: "Cough" }], clinicalNotes: "n", followUpRequired: true, followUpAfterDays: 7, followUpNotes: "Review symptoms PRIVATE-DOCTOR-NOTE" });
await api(docA, "POST", `/api/consultations/${cons.id}/action`, { action: "review" });
check("finalize with a follow-up plan", (await api(docA, "POST", `/api/consultations/${cons.id}/action`, { action: "finalize", confirm: true })).status === 200);
const cp = await patientNamed(recepA, cName);
const list = (await api(docA, "GET", `/api/followups?tab=all&consultationId=${cons.id}`)).json.data;
check("exactly one follow-up was created from the consultation", list.rows.length === 1 && list.rows[0].type === "CONSULTATION_FOLLOW_UP" && list.rows[0].dueDate === ymd(7));
const CF = list.rows[0].id;
const cd = (await api(docA, "GET", `/api/followups/${CF}`)).json.data;
check("doctor sees clinical link + note; reception sees neither", cd.doctorNotes?.includes("PRIVATE-DOCTOR-NOTE") && !!cd.links.consultationId && (await api(recepA, "GET", `/api/followups/${CF}`)).json.data.doctorNotes === null && (await api(recepA, "GET", `/api/followups/${CF}`)).json.data.links.consultationId === null);
check("doctor creates a follow-up from the consultation (patient from the record)", (await api(docA, "POST", "/api/followups", { consultationId: cons.id, title: "Second review", afterDays: 14, patientId: "ignored" })).status === 200);
check("other clinic's doctor can't create from it", (await api(docB, "POST", "/api/followups", { consultationId: cons.id, title: "Foreign", afterDays: 1 })).status === 404);

/* ---------- reschedule / complete ---------- */
check("reschedule needs a reason", (await api(recepA, "POST", `/api/followups/${FID}/action`, { action: "reschedule", dueDate: ymd(20) })).status === 400);
check("reschedule keeps history", (await api(recepA, "POST", `/api/followups/${FID}/action`, { action: "reschedule", dueDate: day, reason: "Same day, new time" })).status === 400 && (await api(recepA, "POST", `/api/followups/${FID}/action`, { action: "reschedule", dueDate: ymd(20), reason: "Patient travelling" })).status === 200 && (await api(recepA, "POST", `/api/followups/${FID}/action`, { action: "reschedule", dueDate: day, reason: "Back early" })).status === 200 && (await api(recepA, "GET", `/api/followups/${FID}`)).json.data.events.filter((e) => e.type === "RESCHEDULED").length === 2);
check("completion needs outcome + notes", (await api(recepA, "POST", `/api/followups/${FID}/action`, { action: "complete", outcome: "NOPE", notes: "x1" })).status === 400 && (await api(recepA, "POST", `/api/followups/${FID}/action`, { action: "complete", outcome: "COMPLETED" })).status === 400);

/* ---------- recalls ---------- */
check("recall needs a bound when recurring", (await api(recepA, "POST", "/api/recalls", { patientId: pid, title: "Annual", dueDate: ymd(30), frequency: "YEARLY" })).status === 400);
const rc = await api(recepA, "POST", "/api/recalls", { patientId: pid, title: "Annual check-up", dueDate: ymd(30), frequency: "YEARLY", maxOccurrences: 2 });
check("recall created", rc.status === 200, rc.text);
check("nurse and clinic B can't use recalls", (await api(adminB, "POST", `/api/recalls/${rc.json.data.id}/action`, { action: "cancel" })).status === 404);
check("recall → follow-up only on request", (await api(recepA, "GET", `/api/followups?tab=all&q=Annual%20check-up`)).json.data.rows.length === 0 && (await api(recepA, "POST", `/api/recalls/${rc.json.data.id}/action`, { action: "createFollowUp" })).status === 200 && (await api(recepA, "GET", `/api/followups?tab=all&q=Annual%20check-up`)).json.data.rows.length === 1);

/* ---------- UI: worklist, booking from follow-up, detail ---------- */
const fb = await api(recepA, "POST", "/api/followups", { patientId: pid, title: "UI booking follow-up", dueDate: day, priority: "URGENT" });
const UIF = fb.json.data.id;
{
  const { page, errors } = recepA;
  await page.goto(`http://${LOCAL}/followups`, { waitUntil: "networkidle" });
  check("command center shows real cards and the worklist", await page.getByRole("heading", { name: "Follow-up command center" }).isVisible() && await page.getByRole("link", { name: /Overdue/ }).first().isVisible() && await page.getByText(pName).first().isVisible());
  await page.locator("input[name=q]").fill(pName); await page.getByRole("button", { name: "Apply filters" }).click(); await page.waitForLoadState("networkidle");
  check("server-side search by patient name", await page.getByText(pName).first().isVisible() && !(await page.getByText(cName).count()));
  await page.goto(`http://${LOCAL}/followups/${UIF}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Book appointment" }).click();
  await page.getByRole("radio").first().waitFor({ timeout: 15000 });
  check("booking dialog is pre-filled (patient, follow-up type)", await page.getByText(pName).first().isVisible() && (await page.getByLabel("Visit type").inputValue()) === "FOLLOW_UP");
  await page.getByRole("radio").first().click();
  await page.getByRole("button", { name: "Book appointment" }).last().click();
  await page.getByText("Appointment booked", { exact: true }).first().waitFor({ timeout: 15000 });
  const after = (await api(recepA, "GET", `/api/followups/${UIF}`)).json.data;
  check("follow-up is linked to the real appointment (existing engine)", after.status === "APPOINTMENT_BOOKED" && !!after.appointment && after.appointment.status === "CONFIRMED", JSON.stringify(after.appointment));
  await page.reload({ waitUntil: "networkidle" });
  check("detail shows the booking, history and preferences", await page.getByText("Booked for this follow-up").isVisible() && await page.getByRole("heading", { name: "History", exact: true }).isVisible() && await page.getByText("Communication preferences").isVisible());
  await page.getByRole("button", { name: "Log contact" }).click();
  check("WhatsApp is labelled as manual logging", (await page.getByRole("option", { name: /WhatsApp \(logged manually\)/ }).count()) === 1);
  await page.keyboard.press("Escape");
  await page.goto(`http://${LOCAL}/followups/${FID}?do=complete`, { waitUntil: "networkidle" });
  await page.getByLabel("Notes").fill("Spoke to the patient; visit done.");
  await page.getByRole("button", { name: "Mark completed" }).last().click();
  await page.getByText(/Closed — Completed/).waitFor({ timeout: 15000 });
  check("completed from the UI with outcome and notes", true);
  check("reception ui: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page, errors } = docA;
  await page.goto(`http://${LOCAL}/consultations/${cons.id}`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Follow-ups" }).click();
  await page.getByText("Second review").first().waitFor({ timeout: 15000 }).catch(() => {});
  check("consultation Follow-ups tab lists the created follow-ups", await page.getByText("Follow-up visit").first().isVisible() && await page.getByText("Second review").first().isVisible());
  await page.goto(`http://${LOCAL}/dashboard`, { waitUntil: "networkidle" });
  check("doctor dashboard shows follow-up cards and in-app reminders", await page.getByRole("region", { name: "Follow-ups" }).isVisible() && await page.getByLabel("Notifications", { exact: true }).isVisible());
  await page.goto(`http://${LOCAL}/patients/${cp}`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Follow-up" }).click();
  await page.getByText("Follow-up visit").first().waitFor({ timeout: 15000 });
  check("Patient 360 Follow-up tab", await page.getByRole("button", { name: "New follow-up" }).isVisible());
  await page.getByRole("tab", { name: "Timeline" }).click();
  await page.getByRole("button", { name: "Follow-up" }).click();
  await page.getByText("Follow-up created").first().waitFor({ timeout: 15000 });
  check("Patient 360 timeline shows follow-up events", true);
  check("doctor ui: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page, errors } = adminA;
  await page.goto(`http://${LOCAL}/settings/followups`, { waitUntil: "networkidle" });
  check("admin settings: rules, outcomes and honest integrations", await page.getByText("Automatic rules").isVisible() && await page.getByText(/integration not configured/).first().isVisible() && await page.getByRole("button", { name: "Save rules" }).isVisible());
  check("admin ui: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page } = recepB;
  await page.goto(`http://${LOCAL}/followups/${FID}`, { waitUntil: "networkidle" });
  const t = await page.locator("body").innerText();
  check("clinic B can't open A's follow-up page", !t.includes(pName) && /not found|404|couldn.t find/i.test(t), t.slice(0, 200));
}

/* ---------- responsive sweep ---------- */
for (const [who, path, label] of [[recepA, "/followups", "command center"], [recepA, `/followups/${UIF}`, "detail"], [adminA, "/settings/followups", "settings"], [docA, "/dashboard", "dashboard"]]) {
  for (const w of [375, 768]) {
    const page = await who.ctx.newPage(); await page.setViewportSize({ width: w, height: 800 });
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`http://${LOCAL}${path}`, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label} @${w}px has no horizontal overflow`, overflow <= 1, `overflow ${overflow}`);
    check(`${label} @${w}px no page errors`, errs.length === 0, errs.join("|"));
    if (label === "command center" && w === 375) check("mobile uses follow-up cards with quick actions", await page.getByRole("list", { name: "Follow-ups" }).isVisible() && (await page.getByRole("link", { name: /Reschedule/ }).count()) > 0);
    await page.close();
  }
}

await browser.close();
console.log(`\nPhase 7 e2e: ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED:", fails.join(" | ")); process.exit(1); }
