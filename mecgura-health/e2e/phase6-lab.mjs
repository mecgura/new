/**
 * Live HTTP + browser checks for Phase 6 (investigations, lab workflow, samples, results, reports, doctor review).
 * Run against a PRODUCTION build after `npm run db:seed`.  node e2e/phase6-lab.mjs
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

const adminA = await login("admin@demo.mecgura.test"), docA = await login("doctor@demo.mecgura.test"), recepA = await login("reception@demo.mecgura.test");
const labA = await login("lab@demo.mecgura.test"), revA = await login("labreviewer@demo.mecgura.test");
const docB = await login("doctor@demob.mecgura.test"), labB = await login("lab@demob.mecgura.test"), adminB = await login("admin@demob.mecgura.test");

/* ---------- setup: lab lists and tests (admin only) ---------- */
check("doctor/reception/lab can't configure the lab", (await api(docA, "POST", "/api/lab/config", { kind: "CATEGORY", name: "X" })).status === 403 && (await api(recepA, "POST", "/api/lab/config", { kind: "CATEGORY", name: "X" })).status === 403 && (await api(labA, "POST", "/api/lab/investigations", { testCode: "ZZ", testName: "Zed", category: "X" })).status === 403);
for (const [kind, name] of [["CATEGORY", "Pathology"], ["SAMPLE_TYPE", "Blood"], ["SAMPLE_TYPE", "Urine"], ["REJECTION_REASON", "Insufficient sample"], ["REJECTION_REASON", "Damaged sample"]]) await api(adminA, "POST", "/api/lab/config", { kind, name });
check("config lists are readable by the doctor", (await api(docA, "GET", "/api/lab/config")).json.data.SAMPLE_TYPE.some((x) => x.name === "Blood"));
const hb = await api(adminA, "POST", "/api/lab/investigations", { testCode: "E2EHB", testName: "E2E Haemoglobin", category: "Pathology", sampleType: "Blood", preparation: "No preparation", parameters: [{ name: "Haemoglobin", resultType: "NUMERIC", unit: "g/dL", ranges: [{ gender: "MALE", low: 13, high: 17 }, { gender: "FEMALE", low: 12, high: 15 }] }] });
const uri = await api(adminA, "POST", "/api/lab/investigations", { testCode: "E2EUR", testName: "E2E Urine routine", category: "Pathology", sampleType: "Urine", parameters: [{ name: "Protein", resultType: "QUALITATIVE", options: [{ value: "Negative", flag: "NEGATIVE" }, { value: "Positive", flag: "POSITIVE" }] }] });
const noRange = await api(adminA, "POST", "/api/lab/investigations", { testCode: "E2EGL", testName: "E2E Glucose", category: "Pathology", sampleType: "Blood", parameters: [{ name: "Glucose", resultType: "NUMERIC", unit: "mg/dL" }] });
check("admin creates tests", hb.status === 200 && uri.status === 200 && noRange.status === 200, hb.text + uri.text);
check("duplicate test code is a conflict", (await api(adminA, "POST", "/api/lab/investigations", { testCode: "e2ehb", testName: "Dup", category: "Pathology" })).status === 409);
check("clinic B doesn't see A's tests", !(await api(docB, "GET", "/api/lab/investigations?q=E2E")).text.includes("E2EHB"));
const HB = hb.json.data.id, URI = uri.json.data.id, GL = noRange.json.data.id;

/* ---------- consultation → investigation order ---------- */
const doctorId = (await api(recepA, "GET", "/api/opd")).json.data.doctors[0].id;
const regConsult = async (name, phone) => {
  const v = (await api(recepA, "POST", "/api/opd", { patient: { newPatient: { name, phone, gender: "MALE", dateOfBirth: "1990-01-01" }, allowDuplicate: true }, doctorUserId: doctorId })).json.data;
  const c = (await api(docA, "POST", "/api/consultations/start", { visitId: v.id })).json.data;
  await api(docA, "POST", `/api/opd/${v.id}`, { action: "hold" });
  return { visitId: v.id, id: c.id };
};
const c1 = await regConsult("E2E Lab Patient", "9876530001");
check("priority is required", (await api(docA, "POST", `/api/consultations/${c1.id}/investigations`, { investigationIds: [HB] })).status === 400);
check("reception/lab/admin can't order", (await api(recepA, "POST", `/api/consultations/${c1.id}/investigations`, { investigationIds: [HB], priority: "NORMAL" })).status === 403 && (await api(labA, "POST", `/api/consultations/${c1.id}/investigations`, { investigationIds: [HB], priority: "NORMAL" })).status === 403);
check("clinic B doctor can't order on A's consultation", (await api(docB, "POST", `/api/consultations/${c1.id}/investigations`, { investigationIds: [HB], priority: "NORMAL" })).status === 404);
const ord = await api(docA, "POST", `/api/consultations/${c1.id}/investigations`, { investigationIds: [HB, URI, GL], priority: "URGENT", clinicalNotes: "e2e note" });
check("doctor orders three tests", ord.status === 200 && /^LAB-\d{4}-\d{6}$/.test(ord.json.data.orderNumber), ord.text);
const OID = ord.json.data.id;
check("doctor order (Phase 5) was linked, not duplicated", (await api(docA, "GET", `/api/orders`)).json.data.orders.filter((o) => o.type === "INVESTIGATION" && o.consultationId === c1.id).length === 1);
check("linked doctor order can't be changed by hand", await (async () => { const o = (await api(docA, "GET", `/api/orders`)).json.data.orders.find((x) => x.type === "INVESTIGATION" && x.consultationId === c1.id); return (await api(docA, "PATCH", `/api/orders/${o.id}`, { status: "COMPLETED" })).status === 409; })());

/* ---------- authorization + tenant isolation ---------- */
check("unauthenticated lab API -> 401", (await fetch(`http://${LOCAL}/api/lab/orders/${OID}`)).status === 401);
check("clinic B can't read, act on or print A's order", (await api(labB, "GET", `/api/lab/orders/${OID}`)).status === 404 && (await api(labB, "POST", `/api/lab/orders/${OID}/action`, { action: "collect", sampleType: "Blood" })).status === 404 && (await api(labB, "POST", `/api/lab/orders/${OID}/slip/print`, {})).status === 404 && (await api(adminB, "GET", `/api/lab/orders/${OID}`)).status === 404);
check("clinic B worklist doesn't include A's orders", !(await api(labB, "GET", "/api/lab/orders?tab=all")).text.includes(ord.json.data.orderNumber));
check("cross-site writes are blocked", (await api(labA, "POST", `/api/lab/orders/${OID}/action`, { action: "collect", sampleType: "Blood" }, "https://evil.example")).status === 403);
check("reception can see the order but never results", (await api(recepA, "GET", `/api/lab/orders/${OID}`)).json.data.seeResults === false);
check("reception can't collect", (await api(recepA, "POST", `/api/lab/orders/${OID}/action`, { action: "collect", sampleType: "Blood" })).status === 403);
check("client-sent tenant/doctor ids are ignored", (await api(docA, "POST", `/api/consultations/${c1.id}/investigations`, { investigationIds: [GL], priority: "NORMAL", tenantId: "x", doctorUserId: "y" })).status === 200);

/* ---------- samples ---------- */
const doCollect = (who, type) => api(who, "POST", `/api/lab/orders/${OID}/action`, { action: "collect", sampleType: type });
const race = await Promise.all([doCollect(labA, "Blood"), doCollect(labA, "Blood"), doCollect(labA, "Blood")]);
check("simultaneous collection creates exactly one sample", race.filter((r) => r.status === 200).length === 1 && race.filter((r) => r.status === 409).length === 2, race.map((r) => r.status).join());
const u = await doCollect(labA, "Urine");
check("second sample type collected", u.status === 200 && /^SMP-\d{4}-\d{6}$/.test(u.json.data.sampleNumber));
let det = (await api(labA, "GET", `/api/lab/orders/${OID}`)).json.data;
check("two samples, status derived", det.samples.length === 2 && det.status === "SAMPLE_COLLECTED");
const urineSample = det.samples.find((s) => s.sampleType === "Urine");
check("rejection needs a configured reason", (await api(labA, "POST", `/api/lab/orders/${OID}/action`, { action: "reject", sampleId: urineSample.id, reason: "Because" })).status === 400);
check("sample rejected → recollection", (await api(labA, "POST", `/api/lab/orders/${OID}/action`, { action: "reject", sampleId: urineSample.id, reason: "Damaged sample" })).status === 200);
const u2 = await doCollect(labA, "Urine");
check("recollection is a new sample (attempt 2)", u2.status === 200 && u2.json.data.attempt === 2);
det = (await api(labA, "GET", `/api/lab/orders/${OID}`)).json.data;
check("old sample and custody chain are kept", det.samples.length === 3 && det.samples.find((s) => s.id === urineSample.id).status === "REJECTED" && det.samples.find((s) => s.id === urineSample.id).events.length === 3);
check("doctor is notified of the rejection", (await api(docA, "GET", "/api/notifications?pageSize=50")).json.data.rows.some((n) => n.type === "LAB_SAMPLE_REJECTED" && n.entityId === OID));
for (const s of det.samples.filter((x) => x.status === "COLLECTED")) await api(labA, "POST", `/api/lab/orders/${OID}/action`, { action: "receive", sampleId: s.id });
check("start processing", (await api(labA, "POST", `/api/lab/orders/${OID}/action`, { action: "startProcessing" })).status === 200);
det = (await api(labA, "GET", `/api/lab/orders/${OID}`)).json.data;
check("order is processing", det.status === "PROCESSING");

/* ---------- results ---------- */
const itemOf = (name) => det.items.find((i) => i.testName.includes(name));
const put = (who, itemId, entries, submit = true) => api(who, "PUT", `/api/lab/orders/${OID}/items/${itemId}/results`, { entries, submit });
check("reception/doctor can't enter results", (await put(recepA, itemOf("Haemo").id, [{ position: 0, value: "14" }])).status === 403 && (await put(docA, itemOf("Haemo").id, [{ position: 0, value: "14" }])).status === 403);
check("non-numeric value is refused", (await put(labA, itemOf("Haemo").id, [{ position: 0, value: "abc" }], false)).status === 400);
check("submitting needs every value", (await put(labA, itemOf("Urine").id, [], true)).status === 400);
check("draft saved", (await put(labA, itemOf("Haemo").id, [{ position: 0, value: "10" }], false)).status === 200);
det = (await api(labA, "GET", `/api/lab/orders/${OID}`)).json.data;
const hbr = itemOf("Haemo").results[0];
check("flag + range come only from configured data (male range)", hbr.flag === "LOW" && hbr.refText === "13 – 17 g/dL", JSON.stringify(hbr));
check("no configured range → no flag and honest text", await (async () => { await put(labA, itemOf("Glucose").id, [{ position: 0, value: "250" }], false); const d = (await api(labA, "GET", `/api/lab/orders/${OID}`)).json.data; const r = d.items.find((i) => i.testName.includes("Glucose")).results[0]; return r.flag === null && r.refText === null; })());
check("submit all three", (await put(labA, itemOf("Haemo").id, [{ position: 0, value: "10" }])).status === 200 && (await put(labA, itemOf("Glucose").id, [{ position: 0, value: "250" }])).status === 200 && (await put(labA, itemOf("Urine").id, [{ position: 0, value: "Negative" }])).status === 200);
check("submitted results are locked", (await put(labA, itemOf("Haemo").id, [{ position: 0, value: "11" }], false)).status === 409);
check("doctor can't see results before release", (await api(docA, "GET", `/api/lab/orders/${OID}`)).json.data.items.every((i) => i.results.length === 0));

/* ---------- report lifecycle ---------- */
const act = (who, a, extra = {}) => api(who, "POST", `/api/lab/orders/${OID}/action`, { action: a, ...extra });
check("generate report", (await act(labA, "generateReport")).status === 200);
check("lab technician can't verify or release", (await act(labA, "verify")).status === 403 && (await act(labA, "release")).status === 403);
check("can't release before verification", (await act(revA, "release")).status === 409);
check("verify then release (reviewer)", (await act(revA, "verify")).status === 200 && (await act(revA, "release")).status === 200);
check("double release is refused", (await act(revA, "release")).status === 409);
det = (await api(docA, "GET", `/api/lab/orders/${OID}`)).json.data;
const RID = det.report.id;
check("doctor sees results and order status after release", det.items.some((i) => i.results.length) && det.report.currentVersion === 1 && det.status === "REPORT_GENERATED");
check("doctor is notified without any result values", await (async () => { const n = (await api(docA, "GET", "/api/notifications?pageSize=50")).json.data.rows.find((x) => x.type === "LAB_REPORT_RELEASED" && x.entityId === RID); return !!n && !/250|Haemoglobin|10/.test(`${n.title} ${n.body}`.replace(/LAB-\d{4}-\d{6}/, "")); })());
check("linked doctor order completed", (await api(docA, "GET", `/api/orders?status=COMPLETED`)).json.data.orders.some((o) => o.type === "INVESTIGATION" && o.consultationId === c1.id));

/* ---------- documents ---------- */
const doc = await api(docA, "GET", `/api/lab/reports/${RID}/document?version=1`);
check("report download is branded, no-store and attachment", doc.status === 200 && /attachment/.test(doc.headers["content-disposition"]) && /no-store/.test(doc.headers["cache-control"]) && /Demo Clinic/.test(doc.text) && !/mecgura health/i.test(doc.text.replace(/mecgura\.test/g, "")) && doc.text.includes("13 – 17 g/dL") && doc.text.includes("Reference range not configured."));
check("report document denied: unauthenticated, reception, other doctor's clinic", (await fetch(`http://${LOCAL}/api/lab/reports/${RID}/document`)).status === 401 && (await api(recepA, "GET", `/api/lab/reports/${RID}/document`)).status === 403 && (await api(docB, "GET", `/api/lab/reports/${RID}/document`)).status === 404 && (await api(labB, "GET", `/api/lab/reports/${RID}/document`)).status === 404);
check("unknown version -> 404", (await api(docA, "GET", `/api/lab/reports/${RID}/document?version=9`)).status === 404);

/* ---------- amendment ---------- */
check("amend needs a reason and a reviewer", (await act(revA, "amend")).status === 400 && (await act(labA, "amend", { reason: "typo" })).status === 403);
check("amend → edit → verify → release v2", (await act(revA, "amend", { reason: "Transcription error" })).status === 200 && (await put(labA, itemOf("Haemo").id, [{ position: 0, value: "14" }])).status === 200 && (await act(revA, "verify")).status === 200 && (await act(revA, "release")).json.data?.version === 2);
const v1 = await api(docA, "GET", `/api/lab/reports/${RID}/document?version=1`), v2 = await api(docA, "GET", `/api/lab/reports/${RID}/document?version=2`);
check("v1 is unchanged and v2 carries the correction", v1.text.includes(">10<") && !v1.text.includes(">14<") && v2.text.includes(">14<") && v2.text.includes("Transcription error"));

/* ---------- doctor review ---------- */
check("only the ordering doctor reviews", (await api(docB, "POST", `/api/lab/reports/${RID}/review`, { status: "REVIEWED" })).status === 404 && (await api(labA, "POST", `/api/lab/reports/${RID}/review`, { status: "REVIEWED" })).status === 403);
check("doctor reviews the latest version", (await api(docA, "POST", `/api/lab/reports/${RID}/review`, { status: "REVIEWED", note: "seen" })).status === 200 && (await api(docA, "GET", `/api/lab/orders/${OID}`)).json.data.status === "DOCTOR_REVIEWED");
check("print/view is audited", (await api(docA, "POST", `/api/lab/reports/${RID}/print`, { version: 2 })).status === 200 && (await api(recepA, "POST", `/api/lab/reports/${RID}/print`, { version: 2 })).status === 403);
check("slip + label print endpoints", (await api(recepA, "POST", `/api/lab/orders/${OID}/slip/print`, {})).status === 200 && (await api(labA, "POST", `/api/lab/samples/${det.samples[0].id}/label/print`, {})).status === 200 && (await api(adminB, "POST", `/api/lab/samples/${det.samples[0].id}/label/print`, {})).status === 404);
check("stats are real counts", (await api(labA, "GET", "/api/lab/stats")).json.data.completedToday >= 1);
check("Patient 360 lab reports for the doctor", (await api(docA, "GET", `/api/consultations/${c1.id}`)).json.data.patient.id && (await api(docA, "GET", `/api/patients/${(await api(docA, "GET", `/api/consultations/${c1.id}`)).json.data.patient.id}/lab-reports`)).json.data.orders.length >= 1);

/* ---------- UI ---------- */
const c2 = await regConsult("E2E UI Patient", "9876530002");
{
  const { page, errors } = docA;
  await page.goto(`http://${LOCAL}/consultations/${c2.id}`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Investigations" }).click();
  await page.getByRole("button", { name: "Order tests" }).click();
  await page.getByRole("checkbox", { name: /E2EHB/ }).check();
  await page.getByRole("button", { name: /Order 1 test/ }).click();
  await page.getByText("Choose a priority.").first().waitFor({ timeout: 10000 }).catch(() => {});
  check("priority is required in the order dialog", (await page.getByText("Choose a priority.").count()) >= 1);
  await page.getByLabel("Priority").selectOption("HIGH");
  await page.getByRole("button", { name: /Order 1 test/ }).click();
  await page.getByText(/LAB-\d{4}-\d{6}/).first().waitFor({ timeout: 15000 });
  check("doctor ordered from the consultation screen", true);
  await page.goto(`http://${LOCAL}/dashboard`, { waitUntil: "networkidle" });
  check("dashboard shows real lab numbers and notifications card", await page.getByRole("heading", { name: "Laboratory", exact: true }).isVisible() && await page.getByLabel("Notifications", { exact: true }).isVisible());
  check("doctor ui: no console errors", errors.length === 0, errors.join(" | "));
}
let uiOrderId;
{
  const { page, errors } = labA;
  await page.goto(`http://${LOCAL}/lab`, { waitUntil: "networkidle" });
  check("lab worklist shows the new order with priority", await page.getByText("E2E UI Patient").first().isVisible() && await page.locator("table").getByText("High").first().isVisible());
  await page.locator("input[name=q]").fill("E2E UI Patient"); await page.getByRole("button", { name: "Apply" }).click(); await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: /LAB-/ }).first().click();
  await page.waitForURL(/\/lab\/orders\/c[a-z0-9]+$/); uiOrderId = page.url().split("/").pop();
  await page.getByRole("button", { name: "Collect Blood" }).click();
  await page.getByText(/SMP-\d{4}-\d{6}/).first().waitFor({ timeout: 15000 });
  check("sample collected from the UI with a sample number", true);
  await page.getByRole("button", { name: "Receive" }).click();
  await page.getByRole("button", { name: /Start processing/ }).click();
  await page.getByRole("textbox", { name: /^Haemoglobin/ }).waitFor({ timeout: 15000 });
  await page.getByRole("textbox", { name: /^Haemoglobin/ }).fill("15");
  await page.getByRole("button", { name: "Submit results" }).click();
  await page.getByRole("button", { name: "Generate report" }).click();
  await page.getByText(/RPT-\d{4}-\d{6}/).first().waitFor({ timeout: 15000 });
  check("results submitted and report generated from the UI", true);
  check("technician sees the 'reviewer must verify' note and no verify button", (await page.getByRole("button", { name: "Verify results" }).count()) === 0 && await page.getByText(/lab reviewer must verify/).isVisible());
  await page.getByRole("link", { name: "Test slip" }).click();
  await page.getByRole("button", { name: "Print" }).waitFor();
  check("test slip page renders", await page.getByText(/Investigation slip LAB-/).isVisible());
  check("lab ui: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page, errors } = revA;
  await page.goto(`http://${LOCAL}/lab/orders/${uiOrderId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Verify results" }).click();
  await page.getByRole("button", { name: "Release report" }).click();
  await page.getByRole("link", { name: "Open released report" }).waitFor({ timeout: 15000 });
  check("reviewer verified and released from the UI", true);
  check("reviewer ui: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page, errors } = docA;
  await page.goto(`http://${LOCAL}/dashboard`, { waitUntil: "networkidle" });
  check("doctor gets an in-app notification for the report", await page.getByLabel("Notifications", { exact: true }).getByText(/Lab report ready/).first().isVisible());
  await page.getByLabel("Notifications", { exact: true }).getByRole("link", { name: /Lab report ready/ }).first().click();
  await page.waitForURL(/\/lab\/reports\//);
  await page.getByText(/Laboratory report RPT-/).first().waitFor({ timeout: 15000 });
  const body = await page.locator("body").innerText();
  check("report page shows clinic branding, patient, result and honest flag", body.includes("Demo Clinic") && body.includes("E2E UI Patient") && /High|Normal|Low/.test(body) && body.includes("13 – 17 g/dL"), body.slice(0, 700));
  await page.getByRole("button", { name: "Mark as reviewed" }).click();
  await page.getByText("You reviewed this version").waitFor({ timeout: 15000 });
  check("doctor marked the report as reviewed", true);
  await page.goto(`http://${LOCAL}/patients`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /E2E UI Patient/ }).first().click();
  await page.getByRole("tab", { name: "Reports" }).click();
  await page.getByRole("link", { name: /LAB-/ }).first().waitFor({ timeout: 15000 });
  check("Patient 360 Reports tab lists the order and report", await page.getByRole("button", { name: /Open report/ }).first().isVisible());
  await page.getByRole("tab", { name: "Timeline" }).click();
  await page.getByRole("button", { name: "Reports" }).click();
  await page.getByText("Report released").first().waitFor({ timeout: 15000 });
  check("timeline shows lab events", await page.getByText(/Investigation ordered/).first().isVisible());
  check("doctor ui (report): no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page, errors } = adminA;
  await page.goto(`http://${LOCAL}/settings/lab`, { waitUntil: "networkidle" });
  check("lab settings: tests, lists and partners (admin can edit)", await page.getByText("E2E Haemoglobin").first().isVisible() && await page.getByRole("button", { name: "Add test" }).isVisible() && await page.getByText("External laboratories").isVisible());
  await page.getByRole("button", { name: "Add test" }).click();
  check("test editor opens with parameter and range editors", await page.getByRole("button", { name: "Add parameter" }).isVisible());
  await page.keyboard.press("Escape");
  check("admin ui: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page } = recepA;
  await page.goto(`http://${LOCAL}/lab/orders/${uiOrderId}`, { waitUntil: "networkidle" });
  const t = await page.locator("body").innerText();
  check("reception sees status but not result values or result forms", /Report generated|Doctor reviewed/.test(t) && !/Reference range/.test(t) && !t.includes("13 – 17") && !(await page.getByRole("button", { name: "Submit results" }).count()), t.slice(0, 400));
  await page.goto(`http://${LOCAL}/lab/reports/${RID}`, { waitUntil: "networkidle" });
  const rt = await page.locator("body").innerText();
  check("reception opening a report page is refused", !rt.includes("13 – 17") && !rt.includes("Laboratory report RPT-") && /not found|404|couldn.t find/i.test(rt), rt.slice(0, 200));
}
{
  const { page } = labB;
  await page.goto(`http://${LOCAL}/lab/orders/${uiOrderId}`, { waitUntil: "networkidle" });
  const t = await page.locator("body").innerText();
  check("clinic B can't open A's order page", !t.includes("E2E UI Patient") && !t.includes("LAB-") && /not found|404|couldn.t find/i.test(t), t.slice(0, 200));
}

/* ---------- responsive sweep ---------- */
for (const [who, path, label] of [[labA, "/lab", "worklist"], [labA, `/lab/orders/${uiOrderId}`, "order"], [docA, `/lab/reports/${RID}`, "report"], [adminA, "/settings/lab", "settings"]]) {
  for (const w of [375, 768]) {
    const page = await who.ctx.newPage(); await page.setViewportSize({ width: w, height: 800 });
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`http://${LOCAL}${path}`, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${label} @${w}px has no horizontal overflow`, overflow <= 1, `overflow ${overflow}`);
    check(`${label} @${w}px no page errors`, errs.length === 0, errs.join("|"));
    await page.close();
  }
}

await browser.close();
console.log(`\nPhase 6 e2e: ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED:", fails.join(" | ")); process.exit(1); }
