/**
 * Live HTTP + browser checks for Phase 13 (analytics, Report Center, exports, RBAC, isolation, responsive).
 * Run against a PRODUCTION build after `npm run db:seed`, with the server started with CRON_SECRET=e2e-cron-secret-0123456789.
 */
import { chromium } from "playwright-core";
const PORT = process.env.PORT ?? "3101"; const LOCAL = `localhost:${PORT}`; const PW = process.env.SEED_DEMO_PASSWORD ?? "Demo-Local-Pass-1";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
let pass = 0; const fails = []; const check = (n, ok, extra = "") => { if (ok) pass++; else { fails.push(n); console.log("  ✗", n, extra); } };
const noise = /Failed to load resource|Cross-Origin-Opener-Policy/;
async function login(path, email) {
  const ctx = await browser.newContext({ baseURL: `http://${LOCAL}` }); const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !noise.test(m.text())) errors.push(m.text()); });
  await page.goto(path); await page.fill("input[name=identifier]", email); await page.fill("input[name=password]", PW); await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }); return { ctx, page, errors };
}
const api = async (c, method, path, body, origin) => { const r = await c.ctx.request.fetch(`http://${LOCAL}${path}`, { method, headers: { "content-type": "application/json", origin: origin ?? `http://${LOCAL}` }, data: body ? JSON.stringify(body) : undefined, failOnStatusCode: false, maxRedirects: 0 }); let json = null, text = ""; try { text = await r.text(); json = JSON.parse(text); } catch { /* */ } return { status: r.status(), json, text, headers: r.headers() }; };
const raw = async (c, path) => { const r = await c.ctx.request.fetch(`http://${LOCAL}${path}`, { failOnStatusCode: false, maxRedirects: 0 }); return { status: r.status(), headers: r.headers(), body: await r.body() }; };

const adminA = await login("/login", "admin@demo.mecgura.test"), docA = await login("/login", "doctor@demo.mecgura.test"), recepA = await login("/login", "reception@demo.mecgura.test"), accA = await login("/login", "accountant@demo.mecgura.test");
const pharmA = await login("/login", "pharmacy@demo.mecgura.test"), pmA = await login("/login", "pharmacymgr@demo.mecgura.test"), labA = await login("/login", "lab@demo.mecgura.test"), adminB = await login("/login", "admin@demob.mecgura.test"), sa = await login("/login", "platform@demo.mecgura.test");
const P1 = await login("/portal/login?clinic=demo-clinic", "patient@demo.mecgura.test");

/* ---------- access ---------- */
for (const p of ["command-center", "patients", "billing", "reports", "settings", "schedules", "platform"]) check(`anonymous /api/analytics/${p} -> 401`, (await fetch(`http://${LOCAL}/api/analytics/${p}`)).status === 401);
check("a patient session can't use analytics APIs", (await api(P1, "GET", "/api/analytics/command-center")).status === 403 && (await api(P1, "GET", "/api/analytics/appointments")).status === 403 && (await api(P1, "GET", "/api/analytics/reports")).status === 403);
check("a patient is sent away from /analytics", await (async () => { await P1.page.goto("/analytics"); await P1.page.waitForTimeout(1200); return !P1.page.url().includes("/analytics"); })());
check("settings writes from another origin are refused (CSRF)", (await api(adminA, "PUT", "/api/analytics/settings", { noShowRatePct: 20 }, "https://evil.example")).status === 403);
check("the super admin has no clinic, so clinic analytics are refused", (await api(sa, "GET", "/api/analytics/command-center")).status === 403);

/* ---------- seed some live activity so the numbers are not all zero ---------- */
const sched = await api(adminA, "GET", "/api/schedule"); const rows = sched.json?.data?.rows ?? sched.json?.data ?? []; const doctorId = rows[0]?.doctorUserId ?? rows[0]?.id;
const pt = await api(recepA, "GET", "/api/patients?q=Demo%20Patient%20One"); const pid = pt.json.data.rows[0].id;
const MARK = `Zz Analytics ${Date.now().toString(36)}`;
const visit = await api(recepA, "POST", "/api/opd", { patient: { newPatient: { name: MARK, phone: `98${String(Date.now()).slice(-8)}` }, allowDuplicate: false }, doctorUserId: doctorId });
check("reception checks a new patient in (live data for the analytics)", visit.status === 200, visit.text.slice(0, 200));

/* ---------- API contract ---------- */
const T = "preset=today";
const cc = await api(adminA, "GET", `/api/analytics/command-center?${T}&compare=1`); const keys = (cc.json?.data?.kpis ?? []).map((k) => k.key);
check("admin Command Center returns the KPIs with freshness metadata", cc.status === 200 && ["patients", "newPatients", "appointments", "completedVisits", "cancelled", "noShows", "revenue", "outstanding"].every((k) => keys.includes(k)) && !!cc.json.data.meta.generatedAt && cc.json.data.meta.timezone === "Asia/Kolkata", cc.text.slice(0, 300));
check("comparison metadata is present", !!cc.json?.data?.meta?.previous);
const opdNow = await api(adminA, "GET", `/api/analytics/opd?${T}`); check("OPD analytics counts today's check-in", opdNow.status === 200 && opdNow.json.data.totals.visits >= 1, opdNow.text.slice(0, 200));
check("every domain answers for the admin", (await Promise.all(["patients", "appointments", "opd", "followups", "doctors", "clinical", "lab", "billing", "pharmacy", "communication", "insights", "scorecard"].map((d) => api(adminA, "GET", `/api/analytics/${d}?preset=last30`)))).every((r) => r.status === 200 && r.json.ok === true));
check("an unknown section is a 404, not a query", (await api(adminA, "GET", "/api/analytics/users;DROP")).status === 404 && (await api(adminA, "GET", "/api/analytics/constructor")).status === 404);
check("bad dates are a readable 400", (await api(adminA, "GET", "/api/analytics/appointments?preset=custom&from=2026-02-30&to=2026-03-01")).status === 400 && (await api(adminA, "GET", "/api/analytics/appointments?preset=custom&from=2026-05-05&to=2026-05-01")).status === 400);
check("garbage filters are rejected", (await api(adminA, "GET", "/api/analytics/appointments?compare=maybe")).status === 400);
check("a tenantId in the query is ignored (tenant comes from the session)", JSON.stringify((await api(adminA, "GET", `/api/analytics/appointments?preset=last30&tenantId=${"x".repeat(5)}`)).json?.data?.meta?.scope) === JSON.stringify({ doctorId: null, own: false }));

/* ---------- RBAC over HTTP ---------- */
const st = async (c, p) => (await api(c, "GET", p)).status;
check("doctor: billing, pharmacy, communication refused; patients/appointments/lab allowed", [await st(docA, "/api/analytics/billing"), await st(docA, "/api/analytics/pharmacy"), await st(docA, "/api/analytics/communication")].every((s) => s === 403) && [await st(docA, "/api/analytics/patients"), await st(docA, "/api/analytics/appointments"), await st(docA, "/api/analytics/lab")].every((s) => s === 200));
const dcc = (await api(docA, "GET", "/api/analytics/command-center?preset=last30")).json.data; check("doctor Command Center has no financial or stock KPIs", !dcc.kpis.some((k) => ["revenue", "collected", "outstanding", "lowStock"].includes(k.key)) && dcc.meta.scope.own === true);
check("a doctor can't look at a colleague by passing doctorId", (await api(docA, "GET", `/api/analytics/appointments?preset=last30&doctorId=${doctorId}x`)).json?.data?.meta?.scope?.own === true);
check("accountant: financial only", [await st(accA, "/api/analytics/billing")].every((s) => s === 200) && [await st(accA, "/api/analytics/appointments"), await st(accA, "/api/analytics/patients"), await st(accA, "/api/analytics/clinical"), await st(accA, "/api/analytics/lab"), await st(accA, "/api/analytics/pharmacy")].every((s) => s === 403));
check("receptionist: no financial / pharmacy / clinical / communication analytics", [await st(recepA, "/api/analytics/billing"), await st(recepA, "/api/analytics/pharmacy"), await st(recepA, "/api/analytics/clinical"), await st(recepA, "/api/analytics/communication")].every((s) => s === 403) && (await st(recepA, "/api/analytics/appointments")) === 200);
check("pharmacy manager: pharmacy only; pharmacy staff: nothing", (await st(pmA, "/api/analytics/pharmacy")) === 200 && (await st(pmA, "/api/analytics/billing")) === 403 && (await st(pharmA, "/api/analytics/command-center")) === 403 && (await st(pharmA, "/api/analytics/pharmacy")) === 403);
check("lab staff: lab only", (await st(labA, "/api/analytics/lab")) === 200 && (await st(labA, "/api/analytics/billing")) === 403 && (await st(labA, "/api/analytics/patients")) === 403);
check("only admins can change thresholds", (await api(docA, "PUT", "/api/analytics/settings", { noShowRatePct: 20 })).status === 403 && (await api(accA, "PUT", "/api/analytics/settings", { noShowRatePct: 20 })).status === 403 && (await api(adminA, "PUT", "/api/analytics/settings", { noShowRatePct: 0 })).status === 400 && (await api(adminA, "PUT", "/api/analytics/settings", { noShowRatePct: 20 })).status === 200);

/* ---------- Report Center + exports ---------- */
const cat = await api(adminA, "GET", "/api/analytics/reports"); check("admin sees all seven report categories", cat.status === 200 && cat.json.data.categories.length === 7 && cat.json.data.reports.length >= 14, cat.text.slice(0, 200));
check("accountant's catalog is Financial only; doctor's has no Financial", (await api(accA, "GET", "/api/analytics/reports")).json.data.reports.every((r) => r.category === "Financial") && !(await api(docA, "GET", "/api/analytics/reports")).json.data.reports.some((r) => r.category === "Financial"));
const rep = await api(adminA, "GET", "/api/analytics/reports/appointments?preset=last30"); check("a report preview carries columns, rows and metadata", rep.status === 200 && Array.isArray(rep.json.data.columns) && !!rep.json.data.meta.generatedBy && rep.json.data.meta.timezone === "Asia/Kolkata", rep.text.slice(0, 200));
check("unknown report -> 404; doctor opening a financial report -> 403", (await api(adminA, "GET", "/api/analytics/reports/nope")).status === 404 && (await api(docA, "GET", "/api/analytics/reports/billing")).status === 403);
const csv = await raw(adminA, "/api/analytics/reports/appointments/export?preset=last30&format=csv"); const csvText = csv.body.toString();
check("CSV export: type, attachment, no-store, nosniff, metadata header", csv.status === 200 && csv.headers["content-type"].startsWith("text/csv") && /attachment; filename="appointments-/.test(csv.headers["content-disposition"]) && /no-store/.test(csv.headers["cache-control"]) && csv.headers["x-content-type-options"] === "nosniff" && /^Report,Appointments/.test(csvText) && /Timezone,Asia\/Kolkata/.test(csvText), csvText.slice(0, 200));
const xlsx = await raw(adminA, "/api/analytics/reports/billing/export?preset=last30&format=xlsx"); check("XLSX export is a real zip with the spreadsheet content type", xlsx.status === 200 && xlsx.body[0] === 0x50 && xlsx.body[1] === 0x4b && /spreadsheetml/.test(xlsx.headers["content-type"]));
const pdf = await raw(adminA, "/api/analytics/reports/billing/export?preset=last30&format=pdf"); check("PDF export is a printable page with a locked-down CSP", pdf.status === 200 && /text\/html/.test(pdf.headers["content-type"]) && /default-src 'none'/.test(pdf.headers["content-security-policy"] ?? "") && !/<script/i.test(pdf.body.toString()));
check("export permissions are enforced on the server", (await raw(docA, "/api/analytics/reports/billing/export?format=csv")).status === 403 && (await raw(recepA, "/api/analytics/reports/appointments/export?format=csv")).status === 403 && (await raw(pharmA, "/api/analytics/reports/pharmacy-stock/export?format=csv")).status === 403 && (await raw(adminA, "/api/analytics/reports/appointments/export?format=exe")).status === 400);
const accCsv = await raw(accA, "/api/analytics/reports/billing/export?preset=last30&format=csv"); check("accountant exports billing but without patient names", accCsv.status === 200 && !/Patient name,/.test(accCsv.body.toString()) && /Patient ID/.test(accCsv.body.toString()));
check("pharmacy manager exports stock; the same user can't export billing", (await raw(pmA, "/api/analytics/reports/pharmacy-stock/export?format=csv")).status === 200 && (await raw(pmA, "/api/analytics/reports/billing/export?format=csv")).status === 403);

/* ---------- scheduled-report foundation + isolation ---------- */
const sc = await api(adminA, "POST", "/api/analytics/schedules", { name: "Weekly appointments", reportKey: "appointments", frequency: "WEEKLY", format: "CSV", preset: "last7" }); check("admin saves a scheduled-report definition", sc.status === 200 && !!sc.json.data.id, sc.text.slice(0, 200));
const sid = sc.json?.data?.id; check("it is listed, with the 'nothing is sent' notice", (await api(adminA, "GET", "/api/analytics/schedules")).json.data.schedules.some((s) => s.id === sid) && /nothing is sent/.test((await api(adminA, "GET", "/api/analytics/schedules")).json.data.delivery));
check("clinic B can't see or delete it (IDOR)", (await api(adminB, "GET", "/api/analytics/schedules")).json.data.schedules.length === 0 && (await api(adminB, "DELETE", `/api/analytics/schedules/${sid}`)).status === 404 && (await api(docA, "POST", "/api/analytics/schedules", { name: "nope nope", reportKey: "appointments", frequency: "DAILY" })).status === 403);
check("clinic B can't use clinic A's doctor id", (await api(adminB, "GET", `/api/analytics/appointments?preset=last30&doctorId=${doctorId}`)).status === 400);
const bOpd = await api(adminB, "GET", `/api/analytics/opd?${T}`); const aOpd = await api(adminA, "GET", `/api/analytics/opd?${T}`);
check("clinic B's analytics don't include clinic A's check-in", bOpd.status === 200 && aOpd.json.data.totals.visits > bOpd.json.data.totals.visits, `${aOpd.json?.data?.totals?.visits} vs ${bOpd.json?.data?.totals?.visits}`);
check("clinic A's patient export has the new patient; clinic B's does not", (await raw(adminA, "/api/analytics/reports/patients/export?preset=last30&format=csv")).body.toString().includes(MARK) && !(await raw(adminB, "/api/analytics/reports/patients/export?preset=last30&format=csv")).body.toString().includes(MARK));
check("scheduled report can be deleted by its own clinic", (await api(adminA, "DELETE", `/api/analytics/schedules/${sid}`)).status === 200);
const plat = await api(sa, "GET", "/api/analytics/platform"); check("super admin sees only clinic counts and platform status", plat.status === 200 && plat.json.data.clinics >= 2 && plat.json.data.status === "operational" && !("patients" in plat.json.data) && (await api(adminA, "GET", "/api/analytics/platform")).status === 403);

/* ---------- UI ---------- */
await adminA.page.goto("/analytics"); await adminA.page.waitForSelector("main h1");
let body = await adminA.page.innerText("body");
check("Command Center renders with KPI list, freshness and the clinic timezone", /Command Center/.test(body) && (await adminA.page.locator('[role=list][aria-label="Key figures"] [role=listitem]').count()) >= 8 && /Last updated/.test(body) && /Asia\/Kolkata/.test(body));
check("the tab bar shows every admin section", ["Patients", "Appointments", "Live OPD", "Doctors", "Follow-ups", "Clinical", "Lab", "Billing", "Pharmacy", "Communication", "Insights", "Scorecard", "Reports"].every((t) => body.includes(t)));
for (const [p, h] of [["patients", /Patient analytics/], ["appointments", /Appointment analytics/], ["opd", /Live OPD analytics/], ["doctors", /Doctor analytics/], ["followups", /Follow-up analytics/], ["clinical", /Consultation, diagnosis/], ["lab", /Laboratory analytics/], ["billing", /Billing analytics/], ["pharmacy", /Pharmacy analytics/], ["communication", /Communication analytics/], ["insights", /Clinic insights/], ["scorecard", /Operations scorecard/]]) {
  await adminA.page.goto(`/analytics/${p}?preset=last30`); await adminA.page.waitForSelector("main h2"); const t = await adminA.page.innerText("body");
  check(`/analytics/${p} renders with freshness and no error state`, h.test(t) && /Last updated/.test(t) && !/Analytics couldn't load|Something went wrong/.test(t));
}
await adminA.page.goto("/analytics/billing?preset=last30"); check("billing page states what its figures mean (not profit)", /Not profit|not profit/.test(await adminA.page.innerText("body")));
await adminA.page.goto("/analytics/opd?preset=today&compare=1"); await adminA.page.waitForSelector("main h2"); check("comparison shows the previous period (or N/A)", /Compared with/.test(await adminA.page.innerText("body")));
check("charts have text alternatives", (await adminA.page.locator('[role=img][aria-label]').count()) + (await adminA.page.locator("table.sr-only").count()) >= 1);
await adminA.page.goto("/analytics/appointments"); await adminA.page.selectOption('select[name=preset]', "custom"); await adminA.page.fill('input[name=from]', "2026-01-01"); await adminA.page.fill('input[name=to]', "2026-01-31"); await adminA.page.check('input[name=compare]'); await adminA.page.click('button[type=submit]:has-text("Apply")');
await adminA.page.waitForURL(/preset=custom/); check("the date filter builds a validated URL (custom range + compare)", /from=2026-01-01/.test(adminA.page.url()) && /to=2026-01-31/.test(adminA.page.url()) && /compare=1/.test(adminA.page.url()));
await adminA.page.goto("/analytics/appointments?preset=custom&from=2026-03-09&to=2026-03-01"); await adminA.page.waitForSelector("main h2"); check("a reversed range shows a readable error, not a crash", /start date is after the end date/i.test(await adminA.page.innerText("body")));
await adminA.page.selectOption('select[name=preset]', "custom"); await adminA.page.fill('input[name=from]', "2026-05-05"); await adminA.page.fill('input[name=to]', "2026-05-01"); await adminA.page.click('button[type=submit]:has-text("Apply")'); check("the filter blocks a reversed range client-side too", (await adminA.page.locator('[role=alert]:has-text("start date is after")').count()) >= 1);
await adminA.page.goto("/analytics/reports"); await adminA.page.waitForSelector("main h2"); body = await adminA.page.innerText("body");
check("Report Center lists categories, sources and the schedule foundation", ["Clinical", "Operational", "Financial", "Patient", "Lab", "Pharmacy", "Communication"].every((c) => body.includes(c)) && /Source:/.test(body) && /Scheduled reports/.test(body) && /not switched on|not active/.test(body));
await adminA.page.goto("/analytics/reports/appointments?preset=last30"); await adminA.page.waitForSelector("main h2"); body = await adminA.page.innerText("body");
check("report page shows source, range, timezone, generated-by and export links", /Source: Appointments/.test(body) && /Timezone: Asia\/Kolkata/.test(body) && /by Demo/.test(body) && (await adminA.page.locator('a[href*="/export?"][href*="format=csv"]').count()) === 1 && (await adminA.page.locator('a[href*="format=xlsx"]').count()) === 1 && (await adminA.page.locator('a[href*="format=pdf"]').count()) === 1);
await recepA.page.goto("/analytics/billing"); await recepA.page.waitForTimeout(1400); check("reception is sent away from billing analytics", recepA.page.url().includes("forbidden"));
await recepA.page.goto("/analytics"); await recepA.page.waitForSelector("main h1"); const rb = (await recepA.page.innerText('nav[aria-label="Analytics sections"]')) + (await recepA.page.innerText('[role=list][aria-label="Key figures"]')); check("reception's analytics tabs and KPIs exclude money", !/Billing|Revenue|Collected/.test(rb) && /Appointments/.test(rb), rb.slice(0, 300));
await docA.page.goto("/analytics"); await docA.page.waitForSelector("main h1"); const db_ = await docA.page.innerText("main"); check("the doctor's page says it shows their own data and hides finance", /own data only/.test(db_) && !/Billing|Revenue|Pharmacy/.test(db_), db_.slice(0, 300));
await accA.page.goto("/analytics"); await accA.page.waitForSelector("main h1"); const ab = await accA.page.innerText("main"); check("accountant sees revenue/outstanding and no clinical tabs", /Revenue \(billed\)/.test(ab) && !/Live OPD/.test(ab) && !/Appointments/.test(ab), ab.slice(0, 300));
await pharmA.page.goto("/analytics"); await pharmA.page.waitForTimeout(1400); check("pharmacy staff can't open analytics", pharmA.page.url().includes("forbidden"));
await adminA.page.goto("/dashboard"); await adminA.page.waitForSelector("nav"); check("the sidebar now has a working Analytics entry", (await adminA.page.locator('a[href="/analytics"]').count()) >= 1);
await adminB.page.goto("/analytics/patients?preset=last30"); await adminB.page.waitForSelector("main h2"); check("clinic B's pages don't mention clinic A's new patient", !(await adminB.page.innerText("body")).includes(MARK));

/* ---------- responsive ---------- */
for (const [c, name, p] of [[adminA, "command center", "/analytics"], [adminA, "appointments", "/analytics/appointments"], [adminA, "billing", "/analytics/billing"], [adminA, "clinical", "/analytics/clinical"], [adminA, "insights", "/analytics/insights"], [adminA, "report center", "/analytics/reports"], [adminA, "report page", "/analytics/reports/billing"]]) {
  await c.page.setViewportSize({ width: 375, height: 740 }); await c.page.goto(`${p}${p.includes("?") ? "&" : "?"}preset=last30`); await c.page.waitForSelector("main h1"); await c.page.waitForTimeout(500);
  check(`no horizontal page scroll at 375px: ${name}`, (await c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
}
await adminA.page.setViewportSize({ width: 1280, height: 800 });
check("no console errors", [adminA, docA, recepA, accA, adminB, pmA].every((c) => c.errors.length === 0), [adminA, docA, recepA, accA, adminB, pmA].flatMap((c) => c.errors).join(" | ").slice(0, 600));
await browser.close(); console.log(`\nPhase 13 e2e: ${pass} passed, ${fails.length} failed`); if (fails.length) { console.log("FAILED:\n - " + fails.join("\n - ")); process.exit(1); }
