/**
 * Live HTTP + browser checks for Phase 5 (consultation, vitals, diagnosis, prescription, orders, documents).
 * Run against a PRODUCTION build after `npm run db:seed`.  node e2e/phase5-consultation.mjs
 */
import { chromium } from "playwright-core";

const PORT = process.env.PORT ?? "3101";
const LOCAL = `localhost:${PORT}`;
const PW = process.env.SEED_DEMO_PASSWORD ?? "Demo-Local-Pass-1";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
let pass = 0; const fails = [];
const check = (n, ok, extra = "") => { if (ok) pass++; else { fails.push(n); console.log("  ✗", n, extra); } };
const noise = /Failed to load resource|Cross-Origin-Opener-Policy/;

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

const recepA = await login("reception@demo.mecgura.test"), adminA = await login("admin@demo.mecgura.test"), docA = await login("doctor@demo.mecgura.test");
const recepB = await login("reception@demob.mecgura.test"), docB = await login("doctor@demob.mecgura.test"), adminB = await login("admin@demob.mecgura.test");

const doctorId = (await api(recepA, "GET", "/api/opd")).json.data.doctors[0].id;
const regVisit = async (who, name, phone, did) => {
  const r = await api(who, "POST", "/api/opd", { patient: { newPatient: { name, phone }, allowDuplicate: true }, doctorUserId: did });
  return r.json.data;
};

/* ---------- API: start, authorization, tenant isolation ---------- */
const v1 = await regVisit(recepA, "E2E Consult Patient", "9876520001", doctorId);
check("reception can't start a consultation", (await api(recepA, "POST", "/api/consultations/start", { visitId: v1.id })).status === 403);
check("admin can't start a consultation", (await api(adminA, "POST", "/api/consultations/start", { visitId: v1.id })).status === 403);
check("clinic B doctor can't start A's visit", (await api(docB, "POST", "/api/consultations/start", { visitId: v1.id })).status === 404);
const st = await api(docA, "POST", "/api/consultations/start", { visitId: v1.id });
check("doctor starts consultation from the visit", st.status === 200 && !!st.json.data.id, st.text);
const cid = st.json.data.id;
check("starting again opens the same consultation (no duplicate)", (await api(docA, "POST", "/api/consultations/start", { visitId: v1.id })).json.data.id === cid);
const got = (await api(docA, "GET", `/api/consultations/${cid}`)).json.data;
check("consultation has number, token, patient and doctor", /^CONS-\d{4}-\d{6}$/.test(got.number) && got.visit.token === v1.token && got.patient.name === "E2E Consult Patient" && got.status === "IN_PROGRESS");
check("reception can't read clinical records", (await api(recepA, "GET", `/api/consultations/${cid}`)).status === 403);
check("clinic B can't read A's consultation (doctor, admin)", (await api(docB, "GET", `/api/consultations/${cid}`)).status === 404 && (await api(adminB, "GET", `/api/consultations/${cid}`)).status === 404);
for (const sub of ["context", "prescription", "orders"]) check(`clinic B can't read A's ${sub}`, (await api(docB, "GET", `/api/consultations/${cid}/${sub}`)).status === 404);
check("clinic B can't write A's consultation", (await api(docB, "PATCH", `/api/consultations/${cid}`, { rev: 0, clinicalNotes: "x" })).status === 404 && (await api(docB, "POST", `/api/consultations/${cid}/diagnoses`, { name: "Injected" })).status === 404 && (await api(docB, "PUT", `/api/consultations/${cid}/prescription`, { items: [] })).status === 404);
check("admin may read but not edit or finalize", (await api(adminA, "GET", `/api/consultations/${cid}`)).status === 200 && (await api(adminA, "PATCH", `/api/consultations/${cid}`, { rev: got.rev, clinicalNotes: "admin edit" })).status === 403 && (await api(adminA, "POST", `/api/consultations/${cid}/action`, { action: "review" })).status === 403);
check("cross-site writes are blocked", (await api(docA, "PATCH", `/api/consultations/${cid}`, { rev: got.rev, clinicalNotes: "x" }, "https://evil.example")).status === 403);
check("unauthenticated API -> 401", (await fetch(`http://${LOCAL}/api/consultations/${cid}`)).status === 401);
check("client-sent tenant/doctor/patient ids are ignored", await (async () => { const r = await api(docA, "PATCH", `/api/consultations/${cid}`, { rev: got.rev, clinicalNotes: "n1", tenantId: "x", doctorUserId: "y", patientId: "z" }); const g = (await api(docA, "GET", `/api/consultations/${cid}`)).json.data; return r.status === 200 && g.patient.id === got.patient.id && g.doctor.id === doctorId; })());
check("medicine search: honest 'not configured'", await (async () => { const r = await api(docA, "GET", "/api/medicines/search?q=para"); return r.status === 200 && r.json.data.configured === false && r.json.data.items.length === 0; })());
check("reception can't search medicines", (await api(recepA, "GET", "/api/medicines/search?q=para")).status === 403);
check("only admins add to the clinic medicine list", (await api(docA, "POST", "/api/medicines", { name: "Nope" })).status === 403);
const stale = (await api(docA, "PATCH", `/api/consultations/${cid}`, { rev: 0, clinicalNotes: "stale" }));
check("stale autosave can't overwrite (409)", stale.status === 409);

/* ---------- API: prescription → document security ---------- */
check("draft prescription has no document yet", (await api(docA, "GET", `/api/consultations/${cid}/prescription/document`)).status === 404);

/* ---------- UI: the doctor's whole workflow ---------- */
const v2 = await regVisit(recepA, "E2E Workflow Patient", "9876520002", doctorId);
await api(docA, "POST", `/api/opd/${v1.id}`, { action: "hold" }); // park the first so the room is free
{
  const { page, errors } = docA;
  await page.goto(`http://${LOCAL}/opd`, { waitUntil: "networkidle" });
  check("OPD offers 'Start consultation' to the doctor", await page.getByRole("button", { name: "Start consultation" }).first().isVisible());
  await page.locator("li", { hasText: "E2E Workflow Patient" }).getByRole("button", { name: "Start consultation" }).click();
  await page.waitForURL(/\/consultations\/c[a-z0-9]+$/, { timeout: 20000 });
  await page.getByRole("heading", { level: 1, name: /E2E Workflow Patient/ }).waitFor();
  await page.getByText("No allergies recorded.").waitFor({ timeout: 10000 }).catch(() => {});
  const body = await page.locator("body").innerText();
  if (process.env.DEBUG_E2E) console.log(body.slice(0, 600));
  check("consultation header: patient, ID, token, doctor, status", /P-\d{6}/.test(body) && body.includes(`Token ${v2.token}`) && /In progress/.test(body) && body.includes("Demo Doctor"));
  check("side panel shows context with honest empties", await page.getByText("No allergies recorded.").isVisible() && (await page.getByText(/No reports or documents yet/).count()) === 1);

  await page.getByRole("button", { name: "Record vitals" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Systolic (mmHg)").fill("128"); await d.getByLabel("Diastolic (mmHg)").fill("82"); await d.getByLabel("Pulse (bpm)").fill("76");
  await d.getByLabel("Weight (kg)").fill("73"); await d.getByLabel("Height (cm)").fill("180");
  await d.getByRole("button", { name: "Save vitals" }).click();
  await page.getByText("128 / 82 mmHg").waitFor({ timeout: 10000 });
  check("vitals saved with calculated BMI", await page.getByText("22.5", { exact: true }).isVisible());
  await page.getByRole("button", { name: "Record vitals" }).click();
  await page.getByRole("dialog").getByLabel("Systolic (mmHg)").fill("90"); await page.getByRole("dialog").getByLabel("Diastolic (mmHg)").fill("120");
  await page.getByRole("dialog").getByRole("button", { name: "Save vitals" }).click();
  await page.getByRole("dialog").getByText(/Diastolic must be lower/).waitFor({ timeout: 10000 }).catch(() => {});
  check("invalid vitals are rejected with a message", await page.getByRole("dialog").getByText(/Diastolic must be lower/).isVisible());
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Complaint & history" }).click();
  await page.getByRole("button", { name: "Add complaint" }).click();
  await page.getByLabel("Complaint", { exact: true }).fill("Cough"); await page.getByLabel("Duration").first().fill("5 days");
  await page.getByText("Saved", { exact: true }).waitFor({ timeout: 10000 });
  check("autosave shows 'Saved'", true);
  await page.getByRole("combobox", { name: /Start from a template/ }).focus();
  await page.getByRole("combobox", { name: /Start from a template/ }).selectOption({ label: "Fever" }).catch(() => {});
  await page.getByLabel("Notes", { exact: true }).last().fill("E2E clinical note");

  await page.getByRole("tab", { name: "Assessment & diagnosis" }).click();
  await page.getByLabel("Assessment", { exact: true }).fill("Doctor's own assessment");
  check("no diagnosis database is pretended", await page.getByText(/No diagnosis database is configured/).isVisible() || await page.getByText(/No diagnosis database/i).first().isVisible());
  await page.getByRole("button", { name: "Add diagnosis" }).click();
  await page.getByRole("dialog").getByLabel(/^Diagnosis/).fill("Viral illness (doctor's entry)"); await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.locator("p.type-label", { hasText: "Viral illness (doctor's entry)" }).waitFor({ timeout: 10000 });
  check("diagnosis added as primary", await page.getByText("Primary", { exact: true }).isVisible());

  await page.getByRole("tab", { name: /^Prescription/ }).click();
  await page.getByRole("button", { name: "Add medicine" }).click();
  const m = page.getByRole("dialog");
  await m.getByLabel(/Search the clinic/).fill("para");
  await m.getByText(/No medicine database configured/).waitFor({ timeout: 10000 });
  check("medicine search says no database configured (no fake results)", true);
  await m.getByLabel(/^Medicine name/).fill("Paracetamol"); await m.getByLabel("Strength").fill("500 mg"); await m.getByLabel(/^Dose/).fill("1 tablet"); await m.getByLabel(/^Frequency/).fill("Twice daily");
  await m.getByLabel("Morning").check(); await m.getByLabel("Night").check(); await m.getByLabel("Duration (days)").fill("3");
  await m.getByRole("button", { name: "Save medicine" }).click();
  await page.getByText(/Paracetamol 500 mg/).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Add medicine" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save medicine" }).click();
  check("medicine needs name, dose and frequency", await page.getByRole("dialog").getByText("Enter the medicine name.").isVisible());
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Advice & follow-up" }).click();
  await page.getByLabel("Doctor's advice").fill("Rest and fluids"); await page.getByLabel("Follow-up required").check(); await page.getByLabel("After (days)").fill("7");
  await page.getByRole("tab", { name: /^Doctor orders/ }).click();
  await page.getByRole("button", { name: "New order" }).click();
  await page.getByRole("dialog").getByLabel(/^Title/).fill("Give prescribed medicine"); await page.getByRole("dialog").getByRole("button", { name: "Create order" }).click();
  await page.getByText("Give prescribed medicine").waitFor({ timeout: 10000 });
  check("doctor order created", true);

  await page.getByRole("button", { name: "Review & finalize" }).click();
  const rv = page.getByRole("dialog");
  await rv.getByText("Review before finalizing").waitFor({ timeout: 10000 });
  const rtext = await rv.innerText();
  check("review screen summarises diagnosis, medicines, advice, follow-up", rtext.includes("Viral illness") && rtext.includes("Paracetamol") && rtext.includes("Rest and fluids") && rtext.includes("After 7 days"));
  check("finalize needs explicit confirmation", await rv.getByRole("button", { name: /Finalize consultation/ }).isDisabled());
  await rv.getByLabel(/I have reviewed this/).check(); await rv.getByRole("button", { name: /Finalize consultation/ }).click();
  await page.getByText("This consultation is finalized").waitFor({ timeout: 15000 });
  check("finalized: locked banner, amend offered", await page.getByRole("button", { name: "Amend consultation" }).isVisible());
  check("finalized: inputs are read-only", await page.getByRole("tab", { name: "Advice & follow-up" }).click().then(() => page.getByLabel("Doctor's advice").isDisabled()));
  check("consultation page: no console errors", errors.length === 0, errors.join(" | "));

  const g = (await api(docA, "GET", page.url().replace(`http://${LOCAL}/consultations/`, "/api/consultations/"))).json.data;
  check("finalize completed the OPD visit and numbered the prescription", g.status === "FINALIZED" && /^RX-\d{4}-\d{6}$/.test(g.prescription.number) && g.prescription.currentVersion === 1);
  const cid2 = g.id, rxNo = g.prescription.number;
  const edit = await api(docA, "PATCH", `/api/consultations/${cid2}`, { rev: g.rev, clinicalNotes: "silent edit" });
  check("finalized consultation can't be silently edited (409)", edit.status === 409);
  check("finalized prescription can't be silently edited (409)", (await api(docA, "PUT", `/api/consultations/${cid2}/prescription`, { items: [{ name: "Sneaky", dose: "1", frequency: "daily" }] })).status === 409);
  check("OPD queue shows the visit completed", (await api(docA, "GET", "/api/opd")).json.data.visits.find((v) => v.id === v2.id)?.status === "COMPLETED");

  /* documents */
  const doc = await api(docA, "GET", `/api/consultations/${cid2}/prescription/document`);
  check("prescription download: attachment, private, branded for the clinic", doc.status === 200 && /attachment/.test(doc.headers["content-disposition"] ?? "") && /no-store/.test(doc.headers["cache-control"] ?? "") && doc.text.includes("Demo Clinic") && doc.text.includes(rxNo) && !doc.text.includes("MECGURA"));
  check("document contains the medicine and advice", doc.text.includes("Paracetamol") && doc.text.includes("Rest and fluids") && doc.text.includes("Viral illness"));
  check("reception / clinic B / anonymous can't get the document", (await api(recepA, "GET", `/api/consultations/${cid2}/prescription/document`)).status === 403 && (await api(docB, "GET", `/api/consultations/${cid2}/prescription/document`)).status === 404 && (await fetch(`http://${LOCAL}/api/consultations/${cid2}/prescription/document`)).status === 401);
  await page.goto(`http://${LOCAL}/consultations/${cid2}/prescription`, { waitUntil: "networkidle" });
  const rxText = await page.locator("#rx-doc").innerText();
  check("print page shows the clinic's header, Rx number, medicine", rxText.includes("Demo Clinic") && rxText.includes(rxNo) && rxText.includes("Paracetamol") && !rxText.includes("MECGURA"));
  const resp = await page.request.get(`http://${LOCAL}/consultations/${cid2}/prescription`, { failOnStatusCode: false });
  check("print page is noindex", /noindex/.test(await resp.text()));

  /* Patient 360 timeline */
  const pid = g.patient.id;
  await page.goto(`http://${LOCAL}/patients/${pid}`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Timeline" }).click(); await page.getByText("Consultation finalized").waitFor({ timeout: 10000 });
  const tl = await page.locator("#patient-panel").innerText();
  check("Patient 360 timeline has consultation, vitals, diagnosis, prescription, order events", ["Consultation started", "Vitals recorded", "Diagnosis added", "Prescription finalized", "Doctor order created", "Consultation finalized"].every((t) => tl.includes(t)));
  await page.getByRole("tab", { name: "Consultations" }).click(); await page.getByText("View full consultation").first().waitFor({ timeout: 10000 });
  check("Patient 360 lists the consultation", true);
  const tlReception = (await api(recepA, "GET", `/api/patients/${pid}/timeline`)).json.data.events.map((e) => e.type).join();
  check("reception's timeline has no clinical events", !/CONSULTATION|PRESCRIPTION|VITALS|DIAGNOSIS|ORDER/.test(tlReception));

  /* amendment */
  await page.goto(`http://${LOCAL}/consultations/${cid2}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Amend consultation" }).click();
  check("amend needs a reason", await page.getByRole("dialog").getByRole("button", { name: "Start amendment" }).isDisabled());
  await page.getByRole("dialog").getByLabel(/^Reason/).fill("Added missing detail"); await page.getByRole("dialog").getByRole("button", { name: "Start amendment" }).click();
  await page.getByText("Amending a finalized consultation").waitFor({ timeout: 10000 });
  check("amendment reopens the consultation, original stays", (await api(docA, "GET", `/api/consultations/${cid2}`)).json.data.status === "IN_PROGRESS");

  /* orders board for the compounder-style workflow (admin sees all) */
  const ob = await api(adminA, "GET", "/api/orders");
  check("admin sees doctor orders; reception doesn't", ob.status === 200 && ob.json.data.orders.some((o) => o.title === "Give prescribed medicine") && (await api(recepA, "GET", "/api/orders")).status === 403);
}
check("reception can't open the consultation page", await (async () => { const r = await recepA.ctx.request.get(`http://${LOCAL}/consultations/${cid}`, { failOnStatusCode: false }); const t = await r.text(); return !t.includes("E2E Consult Patient"); })());
check("clinic B doctor opening A's consultation page sees nothing", await (async () => { const t = await (await docB.ctx.request.get(`http://${LOCAL}/consultations/${cid}`, { failOnStatusCode: false })).text(); return !t.includes("E2E Consult Patient") && /not found/i.test(t); })());

/* ---------- responsive / a11y sweep ---------- */
const sweep = [[docA, `/consultations/${cid}`, ["Vitals", "Complaint & history", "Assessment & diagnosis", "Prescription", "Advice & follow-up", "Doctor orders"]], [docA, "/consultations", []], [docA, "/orders", []], [adminA, "/orders", []]];
for (const width of [320, 375, 390, 430, 768, 1280, 1920]) {
  for (const [acct, path, tabs] of sweep) {
    const page = await acct.ctx.newPage(); await page.setViewportSize({ width, height: 900 });
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`http://${LOCAL}${path}`, { waitUntil: "networkidle" });
    const label = `${path.replace(/c[a-z0-9]{20,}/, ":id")} @${width}`;
    const measure = () => page.evaluate(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, unnamed: [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea")].filter((e) => { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || e.closest("dialog:not([open])") || e.closest("details:not([open]) > :not(summary)")) return false; return !(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || e.textContent?.trim() || e.labels?.length || e.getAttribute("title") || e.getAttribute("placeholder")); }).length, h1: document.querySelectorAll("h1").length }));
    let worst = await measure();
    for (const t of tabs) { await page.getByRole("tab", { name: t }).first().click(); await page.waitForTimeout(250); const m = await measure(); if (m.over > worst.over) worst = { ...worst, over: m.over }; if (m.unnamed) worst.unnamed = m.unnamed; }
    check(`${label}: no horizontal overflow (all tabs)`, worst.over <= 1, `${worst.over}px`);
    check(`${label}: one h1, controls named, no js errors`, worst.h1 === 1 && worst.unnamed === 0 && errs.length === 0, `h1=${worst.h1} unnamed=${worst.unnamed} ${errs.join("|")}`);
    await page.close();
  }
}

console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) console.log(fails.map((f) => " - " + f).join("\n"));
await browser.close();
process.exit(fails.length ? 1 : 0);
