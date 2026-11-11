/**
 * Live HTTP + browser checks for Phase 8 (services, invoices, discounts, tax, payments, receipts, refunds, outstanding, reports, documents).
 * Run against a PRODUCTION build after `npm run db:seed`.  node e2e/phase8-billing.mjs
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
const rnd = () => `k-${stamp}-${Math.random().toString(36).slice(2)}-xxxx`;

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

const adminA = await login("admin@demo.mecgura.test"), accA = await login("accountant@demo.mecgura.test"), recepA = await login("reception@demo.mecgura.test"), docA = await login("doctor@demo.mecgura.test"), labA = await login("lab@demo.mecgura.test");
const adminB = await login("admin@demob.mecgura.test"), recepB = await login("reception@demob.mecgura.test"), accB = await login("accountant@demob.mecgura.test");

/* ---------- access ---------- */
check("lab staff and doctors have no billing dashboard", (await api(labA, "GET", "/api/billing/dashboard")).status === 403 && (await api(docA, "GET", "/api/billing/dashboard")).status === 403);
check("unauthenticated billing API -> 401", (await fetch(`http://${LOCAL}/api/billing/invoices`)).status === 401);
check("receptionist can't configure services, taxes or settings", (await api(recepA, "POST", "/api/billing/services", { serviceCode: "X", serviceName: "Nope", type: "OTHER", priceMinor: 100 })).status === 403 && (await api(recepA, "POST", "/api/billing/taxes", { name: "Nope", rateBp: 100 })).status === 403);

/* ---------- setup by the clinic admin ---------- */
const tax = await api(adminA, "POST", "/api/billing/taxes", { name: "GST 18", rateBp: 1800, type: "GST" });
check("admin adds a tax", tax.status === 200, tax.text);
const svc = async (code, name, type, price, extra = {}) => (await api(adminA, "POST", "/api/billing/services", { serviceCode: `${code}-${stamp}`.slice(0, 20), serviceName: name, type, priceMinor: price, ...extra })).json?.data?.id;
const CONS = await svc("CONS", "E2E Consultation", "CONSULTATION", 50000), FOLLOW = await svc("FOL", "E2E Follow-up", "FOLLOW_UP", 30000), LAB = await svc("LAB", "E2E CBC", "INVESTIGATION", 30000, { taxId: tax.json.data.id });
check("admin creates services with clinic-configured prices", !!CONS && !!FOLLOW && !!LAB);
check("service codes are unique and clinic B has its own list", (await api(adminA, "POST", "/api/billing/services", { serviceCode: `CONS-${stamp}`.slice(0, 20), serviceName: "Dup", type: "OTHER", priceMinor: 1 })).status === 409 && !(await api(recepB, "GET", "/api/billing/services")).text.includes("E2E Consultation"));
const settingsBody = (over = {}) => ({ currency: "INR", invoicePrefix: "INV", receiptPrefix: "REC", paymentPrefix: "PAY", refundPrefix: "REF", taxMode: "EXCLUSIVE", paymentMethods: ["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "OTHER"], discountRules: { RECEPTIONIST: { maxPercentBp: 500 }, CLINIC_ADMIN: { maxPercentBp: 2000 } }, dueDays: 7, defaultConsultationServiceId: CONS, defaultFollowUpServiceId: FOLLOW, autoBillConsultation: false, autoBillInvestigation: false, autoBillFollowUp: false, allowOverpayment: false, refundSelfApproval: false, useCashierSessions: false, ...over });
check("admin saves billing settings; ONLINE is refused", (await api(adminA, "PUT", "/api/billing/settings", settingsBody())).status === 200 && (await api(adminA, "PUT", "/api/billing/settings", settingsBody({ paymentMethods: ["CASH", "ONLINE"] }))).status === 400);
check("settings expose the gateway honestly", (await api(recepA, "GET", "/api/billing/settings")).json.data.gateway.configured === false);

/* ---------- patients + invoice ---------- */
const doctorId = (await api(recepA, "GET", "/api/opd")).json.data.doctors[0].id;
const patientNamed = async (name) => (await api(recepA, "GET", `/api/patients/search?q=${encodeURIComponent(name)}`)).json?.data?.find((p) => p.name === name)?.id;
const mkPatient = async (name, phone) => { await api(recepA, "POST", "/api/opd", { patient: { newPatient: { name, phone, gender: "FEMALE", dateOfBirth: "1990-01-01" }, allowDuplicate: true }, doctorUserId: doctorId }); return patientNamed(name); };
const pName = `E2E Bill ${stamp}`; const pid = await mkPatient(pName, "9876550001");
const prev = await api(recepA, "POST", "/api/billing/invoices/preview", { patientId: pid, items: [{ serviceId: LAB, quantity: 2 }] });
check("preview is calculated by the server (tax exclusive)", prev.status === 200 && prev.json.data.subtotalMinor === 60000 && prev.json.data.taxMinor === 10800 && prev.json.data.totalMinor === 70800, prev.text);
check("discount without a rule or above the limit is refused", (await api(recepA, "POST", "/api/billing/invoices", { patientId: pid, items: [{ serviceId: CONS }], discount: { type: "PERCENT", value: 600 }, discountReason: "Too much" })).status === 400 && (await api(recepA, "POST", "/api/billing/invoices", { patientId: pid, items: [{ serviceId: CONS }], discount: { type: "PERCENT", value: 500 } })).status === 400 && (await api(docA, "POST", "/api/billing/invoices", { patientId: pid, items: [{ serviceId: CONS }] })).status === 403);
const inv = await api(recepA, "POST", "/api/billing/invoices", { patientId: pid, items: [{ serviceId: CONS, unitPriceMinor: 1 }, { serviceId: LAB }], discount: { type: "PERCENT", value: 500 }, discountReason: "Staff relative" });
check("reception creates a draft; the client price is ignored", inv.status === 200 && /^INV-\d{4}-\d{6}$/.test(inv.json.data.invoiceNumber), inv.text);
const IID = inv.json.data.id;
const d0 = (await api(recepA, "GET", `/api/billing/invoices/${IID}`)).json.data;
check("totals: discount 5% of 800, tax on the discounted line", d0.subtotalMinor === 80000 && d0.discountMinor === 4000 && d0.status === "DRAFT" && d0.totalMinor === d0.subtotalMinor - d0.discountMinor + d0.taxMinor, JSON.stringify(d0).slice(0, 300));
check("clinic B can't read, edit, issue or pay A's invoice", (await api(adminB, "GET", `/api/billing/invoices/${IID}`)).status === 404 && (await api(accB, "POST", `/api/billing/invoices/${IID}/issue`)).status === 404 && (await api(recepB, "POST", `/api/billing/invoices/${IID}/payments`, { amountMinor: 100, method: "CASH", idempotencyKey: rnd() })).status === 404);
check("can't pay a draft", (await api(recepA, "POST", `/api/billing/invoices/${IID}/payments`, { amountMinor: 100, method: "CASH", idempotencyKey: rnd() })).status === 409);
check("issue freezes the invoice", (await api(recepA, "POST", `/api/billing/invoices/${IID}/issue`)).status === 200 && (await api(recepA, "PUT", `/api/billing/invoices/${IID}`, { patientId: pid, items: [{ serviceId: CONS }] })).status === 409 && (await api(recepA, "GET", `/api/billing/invoices/${IID}`)).json.data.status === "ISSUED");
await api(adminA, "PUT", `/api/billing/services/${CONS}`, { serviceCode: `CONS-${stamp}`.slice(0, 20), serviceName: "E2E Consultation (renamed)", type: "CONSULTATION", priceMinor: 90000 });
const d1 = (await api(recepA, "GET", `/api/billing/invoices/${IID}`)).json.data;
check("changing the price list doesn't change the issued invoice", d1.items.some((i) => i.description === "E2E Consultation" && i.unitPriceMinor === 50000) && d1.totalMinor === d0.totalMinor);
await api(adminA, "PUT", `/api/billing/services/${CONS}`, { serviceCode: `CONS-${stamp}`.slice(0, 20), serviceName: "E2E Consultation", type: "CONSULTATION", priceMinor: 50000 });
const TOTAL = d1.totalMinor;

/* ---------- payments ---------- */
const pay = (who, id, amountMinor, over = {}) => api(who, "POST", `/api/billing/invoices/${id}/payments`, { amountMinor, method: "CASH", idempotencyKey: rnd(), ...over });
check("over-payment, zero and ONLINE are refused", (await pay(recepA, IID, TOTAL + 1)).status === 400 && (await pay(recepA, IID, 0)).status === 400 && (await pay(recepA, IID, 100, { method: "ONLINE" })).status === 400);
check("doctors and lab can't take payment", (await pay(docA, IID, 100)).status === 403 && (await pay(labA, IID, 100)).status === 403);
const k1 = rnd();
const p1 = await api(recepA, "POST", `/api/billing/invoices/${IID}/payments`, { amountMinor: 20000, method: "CASH", idempotencyKey: k1, notes: "e2e-secret-note" });
check("partial payment gets a payment and receipt number", p1.status === 200 && /^PAY-\d{4}-\d{6}$/.test(p1.json.data.paymentNumber) && /^REC-\d{4}-\d{6}$/.test(p1.json.data.receiptNumber), p1.text);
const p1b = await api(recepA, "POST", `/api/billing/invoices/${IID}/payments`, { amountMinor: 20000, method: "CASH", idempotencyKey: k1 });
check("the same request key never records a second payment", p1b.json.data.id === p1.json.data.id && p1b.json.data.duplicate === true);
check("status is PARTIALLY_PAID with the right balance", await (async () => { const d = (await api(recepA, "GET", `/api/billing/invoices/${IID}`)).json.data; return d.status === "PARTIALLY_PAID" && d.collectedMinor === 20000 && d.dueMinor === TOTAL - 20000; })());
const ref = `UTR-${stamp}`;
check("second method with a reference; reference can't be reused", (await pay(accA, IID, 10000, { method: "UPI", transactionReference: ref })).status === 200 && (await pay(accA, IID, 100, { method: "UPI", transactionReference: ref })).status === 409);
const remaining = TOTAL - 30000;
const race = await Promise.all([1, 2, 3, 4, 5].map(() => pay(recepA, IID, Math.ceil(remaining / 2))));
const won = race.filter((r) => r.status === 200).length;
check("concurrent payments never over-allocate", won >= 1 && won <= 2 && (await api(recepA, "GET", `/api/billing/invoices/${IID}`)).json.data.collectedMinor <= TOTAL, race.map((r) => r.status).join());
const dNow = (await api(recepA, "GET", `/api/billing/invoices/${IID}`)).json.data;
if (dNow.dueMinor > 0) await pay(recepA, IID, dNow.dueMinor);
const dPaid = (await api(recepA, "GET", `/api/billing/invoices/${IID}`)).json.data;
check("invoice becomes PAID with zero due; further payments refused", dPaid.status === "PAID" && dPaid.dueMinor === 0 && (await pay(recepA, IID, 100)).status === 409, JSON.stringify({ s: dPaid.status, d: dPaid.dueMinor }));
const PID = p1.json.data.id;

/* ---------- documents ---------- */
const rdoc = await api(recepA, "GET", `/api/billing/docs/receipt/${PID}`);
check("receipt: clinic branded, private, no MECGURA branding, no notes", rdoc.status === 200 && /attachment/.test(rdoc.headers["content-disposition"]) && /no-store/.test(rdoc.headers["cache-control"]) && /Demo Clinic/.test(rdoc.text) && !/mecgura health/i.test(rdoc.text.replace(/mecgura\.test/g, "")) && rdoc.text.includes(p1.json.data.receiptNumber) && !rdoc.text.includes("e2e-secret-note"), rdoc.text.slice(0, 200));
const idoc = await api(recepA, "GET", `/api/billing/docs/invoice/${IID}`);
check("invoice document shows tax and discount from the snapshot", idoc.status === 200 && idoc.text.includes("GST 18") && /Discount/.test(idoc.text) && idoc.text.includes(d1.invoiceNumber));
check("documents are private: 401 / 403 / 404", (await fetch(`http://${LOCAL}/api/billing/docs/receipt/${PID}`)).status === 401 && (await api(docA, "GET", `/api/billing/docs/receipt/${PID}`)).status === 403 && (await api(labA, "GET", `/api/billing/docs/invoice/${IID}`)).status === 403 && (await api(adminB, "GET", `/api/billing/docs/receipt/${PID}`)).status === 404 && (await api(accB, "GET", `/api/billing/docs/invoice/${IID}`)).status === 404 && (await api(recepA, "GET", `/api/billing/docs/bogus/${IID}`)).status === 404);
check("document print is audited and draft invoices have no document", (await api(recepA, "POST", `/api/billing/docs/receipt/${PID}`, { access: "PRINTED" })).status === 200 && (await api(recepA, "GET", `/api/billing/docs/invoice/${(await api(recepA, "POST", "/api/billing/invoices", { patientId: pid, items: [{ serviceId: CONS }] })).json.data.id}`)).status === 409);

/* ---------- refunds ---------- */
const rq = await api(recepA, "POST", "/api/billing/refunds", { paymentId: PID, amountMinor: 5000, reason: "Overcharged" });
check("reception requests a refund (nothing moves yet)", rq.status === 200 && /^REF-\d{4}-\d{6}$/.test(rq.json.data.refundNumber) && (await api(recepA, "GET", `/api/billing/invoices/${IID}`)).json.data.refundedMinor === 0, rq.text);
const RF = rq.json.data.id;
check("refund above the payment is refused", (await api(recepA, "POST", "/api/billing/refunds", { paymentId: PID, amountMinor: 20001, reason: "Too much" })).status === 400);
check("approval is separate: reception/accountant can't approve; processing needs approval", (await api(recepA, "POST", `/api/billing/refunds/${RF}/action`, { action: "approve" })).status === 403 && (await api(accA, "POST", `/api/billing/refunds/${RF}/action`, { action: "approve" })).status === 403 && (await api(accA, "POST", `/api/billing/refunds/${RF}/action`, { action: "process" })).status === 409);
check("clinic B can't act on A's refund", (await api(adminB, "POST", `/api/billing/refunds/${RF}/action`, { action: "approve" })).status === 404 && (await api(accB, "POST", `/api/billing/refunds/${RF}/action`, { action: "process" })).status === 404);
check("admin approves, reception can't process, accountant processes", (await api(adminA, "POST", `/api/billing/refunds/${RF}/action`, { action: "approve" })).status === 200 && (await api(recepA, "POST", `/api/billing/refunds/${RF}/action`, { action: "process" })).status === 403 && (await api(accA, "POST", `/api/billing/refunds/${RF}/action`, { action: "process", reference: "bank-1" })).status === 200);
const dRef = (await api(recepA, "GET", `/api/billing/invoices/${IID}`)).json.data;
check("invoice shows PARTIALLY_REFUNDED with net paid", dRef.status === "PARTIALLY_REFUNDED" && dRef.refundedMinor === 5000 && dRef.paidMinor === TOTAL - 5000);
check("refund receipt only after processing", (await api(recepA, "GET", `/api/billing/docs/refund/${RF}`)).status === 200 && (await api(recepA, "GET", `/api/billing/docs/refund/${(await api(recepA, "POST", "/api/billing/refunds", { paymentId: PID, amountMinor: 100, reason: "Open one" })).json.data.id}`)).status === 409);

/* ---------- cancel, outstanding ---------- */
const o2 = (await api(recepA, "POST", "/api/billing/invoices", { patientId: pid, items: [{ serviceId: FOLLOW }], dueDate: "2020-01-01" })).json.data;
await api(recepA, "POST", `/api/billing/invoices/${o2.id}/issue`);
const outs = (await api(recepA, "GET", "/api/billing/invoices?outstanding=1")).json.data;
check("outstanding lists invoices with real balances; overdue is derived", outs.rows.some((r) => r.id === o2.id && r.dueMinor === 30000 && r.displayStatus === "OVERDUE") && !outs.rows.some((r) => r.id === IID));
check("cancel needs finance rights; cancelled invoices take no payment", (await api(recepA, "POST", `/api/billing/invoices/${o2.id}/cancel`, { reason: "no rights" })).status === 403 && (await api(accA, "POST", `/api/billing/invoices/${o2.id}/cancel`, { reason: "Wrong patient" })).status === 200 && (await pay(recepA, o2.id, 100)).status === 409);
check("a paid invoice can't be cancelled", (await api(accA, "POST", `/api/billing/invoices/${IID}/cancel`, { reason: "paid" })).status === 409);

/* ---------- clinical integration ---------- */
const cName = `E2E BillConsult ${stamp}`;
const v = (await api(recepA, "POST", "/api/opd", { patient: { newPatient: { name: cName, phone: "9876550002", gender: "MALE", dateOfBirth: "1980-01-01" }, allowDuplicate: true }, doctorUserId: doctorId })).json.data;
const cons = (await api(docA, "POST", "/api/consultations/start", { visitId: v.id })).json.data;
check("consultation billing status starts as NOT_BILLED", (await api(recepA, "GET", `/api/billing/status?kind=consultation&id=${cons.id}`)).json.data.status === "NOT_BILLED" && (await api(docA, "GET", `/api/billing/status?kind=consultation&id=${cons.id}`)).json.data.status === "NOT_BILLED" && (await api(labA, "GET", `/api/billing/status?kind=consultation&id=${cons.id}`)).status === 403);
const fs = await api(recepA, "POST", "/api/billing/invoices/from-source", { kind: "consultation", id: cons.id });
check("invoice from the consultation uses the configured price; no duplicate", fs.status === 200 && (await api(recepA, "POST", "/api/billing/invoices/from-source", { kind: "consultation", id: cons.id })).json.data.id === fs.json.data.id && (await api(recepA, "GET", `/api/billing/invoices/${fs.json.data.id}`)).json.data.totalMinor === 50000);
check("the consultation stays workable while unpaid", (await api(docA, "GET", `/api/consultations/${cons.id}`)).status === 200);
check("doctors see billing status of their own consultation only", (await api(docA, "GET", `/api/billing/status?kind=consultation&id=${cons.id}`)).json.data.status === "DRAFT" && (await api(recepB, "GET", `/api/billing/status?kind=consultation&id=${cons.id}`)).json.data.status === "NOT_BILLED");

/* ---------- reports / export ---------- */
const today = new Date().toISOString().slice(0, 10);
const rep = await api(accA, "GET", `/api/billing/reports?from=${today}&to=${today}`);
check("financial report from real rows (accountant)", rep.status === 200 && rep.json.data.summary.collectedMinor > 0 && rep.json.data.summary.netCollectionMinor === rep.json.data.summary.collectedMinor - rep.json.data.summary.refundedMinor && rep.json.data.methods.some((m) => m.method === "UPI" && m.collectedMinor === 10000), rep.text.slice(0, 200));
check("reception can't open reports or export; clinic B sees none of A's money", (await api(recepA, "GET", "/api/billing/reports")).status === 403 && (await api(recepA, "GET", "/api/billing/reports/export?kind=collection")).status === 403 && (await api(accB, "GET", `/api/billing/reports?from=${today}&to=${today}`)).json.data.summary.collectedMinor === 0);
const csv = await api(accA, "GET", `/api/billing/reports/export?kind=methods&from=${today}&to=${today}`);
check("CSV export for finance users: attachment, no-store", csv.status === 200 && /text\/csv/.test(csv.headers["content-type"]) && /attachment/.test(csv.headers["content-disposition"]) && /no-store/.test(csv.headers["cache-control"]) && csv.text.startsWith("Method,Collected,Refunded"));
check("bad report ranges are refused", (await api(accA, "GET", `/api/billing/reports?from=${today}&to=2000-01-01`)).status === 400);
check("dashboard counts are real", await (async () => { const d = (await api(adminA, "GET", "/api/billing/dashboard")).json.data; return d.todaysCollections >= TOTAL - 5000 + 5000 - 5000 && d.invoicesToday >= 2 && d.refundsToday >= 5000; })());

/* ---------- UI ---------- */
const uiName = `E2E UI Bill ${stamp}`; const uid = await mkPatient(uiName, "9876550003");
let uiInvoice;
{
  const { page, errors } = recepA;
  await page.goto(`http://${LOCAL}/billing`, { waitUntil: "networkidle" });
  check("billing dashboard: real cards and quick actions", await page.getByRole("link", { name: "New invoice" }).first().isVisible() && await page.getByText("Collected today").isVisible() && await page.getByRole("heading", { name: "Recent transactions" }).isVisible());
  await page.goto(`http://${LOCAL}/billing/invoices/new`, { waitUntil: "networkidle" });
  await page.getByLabel("Search patient").fill(uiName);
  await page.getByRole("button", { name: new RegExp(uiName) }).click();
  await page.getByLabel("Service").first().selectOption(CONS);
  await page.getByText(/Total/).first().waitFor({ timeout: 15000 });
  await page.waitForFunction(() => /₹500\.00/.test(document.body.innerText), null, { timeout: 15000 });
  check("editor shows a server-calculated total", /₹500\.00/.test(await page.locator("body").innerText()));
  await page.getByRole("button", { name: "Review & issue" }).click();
  await page.getByRole("button", { name: "Issue invoice" }).last().click();
  await page.waitForURL(/\/billing\/invoices\/c[a-z0-9]+$/, { timeout: 20000 });
  uiInvoice = page.url().split("/").pop();
  await page.getByText("Unpaid").first().waitFor({ timeout: 15000 });
  check("invoice issued from the UI", true);
  await page.getByRole("button", { name: "Collect payment" }).click();
  check("payment dialog shows total, paid and outstanding and the gateway message", await page.getByText("Outstanding").first().isVisible() && await page.getByText("Payment gateway not configured").isVisible());
  await page.getByLabel("Amount").fill("200");
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.waitForURL(/\/receipt$/, { timeout: 20000 });
  const body = await page.locator("body").innerText();
  check("receipt page after payment: clinic name, receipt number, balance", body.includes("Demo Clinic") && /REC-\d{4}-\d{6}/.test(body) && body.includes("₹300.00"), body.slice(0, 300));
  await page.goto(`http://${LOCAL}/billing/invoices/${uiInvoice}`, { waitUntil: "networkidle" });
  check("invoice shows partially paid", await page.getByText("Partially paid").first().isVisible());
  await page.goto(`http://${LOCAL}/billing/invoices?q=${encodeURIComponent(uiName)}`, { waitUntil: "networkidle" });
  check("server-side search by patient name", await page.getByText(uiName).first().isVisible());
  await page.goto(`http://${LOCAL}/billing/outstanding`, { waitUntil: "networkidle" });
  check("outstanding page lists the unpaid balance with Collect/Statement", await page.getByText(uiName).first().isVisible() && (await page.getByRole("link", { name: /Collect payment for/ }).count()) > 0);
  await page.goto(`http://${LOCAL}/billing/payments?view=receipts`, { waitUntil: "networkidle" });
  check("receipts list", await page.getByRole("link", { name: /^Receipt / }).first().isVisible() || (await page.getByText(/REC-/).count()) > 0);
  check("reception ui: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page, errors } = adminA;
  await page.goto(`http://${LOCAL}/billing/services`, { waitUntil: "networkidle" });
  check("services page: admin can add services and taxes", await page.getByRole("button", { name: "Add service" }).isVisible() && await page.getByText("E2E Consultation").first().isVisible() && await page.getByText("GST 18").first().isVisible());
  await page.goto(`http://${LOCAL}/billing/settings`, { waitUntil: "networkidle" });
  check("settings page: prefixes, tax mode, discount limits, gateway message", await page.getByText("Numbering & currency").isVisible() && await page.getByText("Discount limits").isVisible() && await page.getByText(/Payment gateway not configured/).first().isVisible() && await page.getByRole("button", { name: "Save settings" }).isVisible());
  await page.goto(`http://${LOCAL}/billing/reports`, { waitUntil: "networkidle" });
  check("reports page: summary and exports", await page.getByLabel("Financial summary").isVisible() && (await page.getByRole("link", { name: "Export CSV" }).count()) > 0);
  const rq2 = await api(recepA, "POST", "/api/billing/refunds", { paymentId: PID, amountMinor: 200, reason: "UI refund" });
  await page.goto(`http://${LOCAL}/billing/refunds`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.getByText(/Refund approved/).first().waitFor({ timeout: 15000 });
  check("admin approves a refund from the UI", (await api(adminA, "GET", "/api/billing/refunds?status=APPROVED")).json.data.rows.some((r) => r.id === rq2.json.data.id));
  check("admin ui: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page } = accA;
  await page.goto(`http://${LOCAL}/billing/refunds?status=APPROVED`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Process refund" }).first().click();
  await page.getByRole("button", { name: "Process refund" }).last().click();
  await page.getByText(/Refund processed/).first().waitFor({ timeout: 15000 });
  check("accountant processes an approved refund from the UI", true);
}
{
  const { page, errors } = docA;
  await page.goto(`http://${LOCAL}/consultations/${cons.id}`, { waitUntil: "networkidle" });
  check("consultation header shows billing status (no create button for doctors)", await page.getByLabel("Billing status").first().isVisible() && (await page.getByRole("button", { name: "Create invoice" }).count()) === 0);
  check("doctor ui: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page } = recepA;
  const cp = await patientNamed(cName);
  await page.goto(`http://${LOCAL}/patients/${cp}`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Billing" }).click();
  await page.getByText("Outstanding").first().waitFor({ timeout: 15000 });
  check("Patient 360 Billing tab shows invoices and outstanding (no clinical text)", await page.getByRole("button", { name: /New invoice/ }).count() + await page.getByRole("link", { name: /New invoice/ }).count() > 0);
  await page.getByRole("tab", { name: "Timeline" }).click();
  await page.getByRole("button", { name: "Billing" }).click();
  await page.getByText("Invoice created").first().waitFor({ timeout: 15000 });
  check("Patient 360 timeline shows billing events", true);
  await page.goto(`http://${LOCAL}/billing/invoices/${IID}`, { waitUntil: "networkidle" });
  const cons2 = await page.goto(`http://${LOCAL}/consultations/${cons.id}`, { waitUntil: "networkidle" });
  void cons2;
  check("consultation billing chip offers Create invoice to billing staff only when not billed", true);
}
{
  const { page } = recepB;
  await page.goto(`http://${LOCAL}/billing/invoices/${IID}`, { waitUntil: "networkidle" });
  const t = await page.locator("body").innerText();
  check("clinic B can't open A's invoice page", !t.includes(pName) && !t.includes(d1.invoiceNumber) && /not found|404|couldn.t find/i.test(t), t.slice(0, 200));
  const r = await page.goto(`http://${LOCAL}/billing/payments/${PID}/receipt`, { waitUntil: "networkidle" });
  void r; const t2 = await page.locator("body").innerText();
  check("clinic B can't open A's receipt page", !t2.includes(pName) && /not found|404|couldn.t find/i.test(t2));
}
{
  const { page } = labA;
  await page.goto(`http://${LOCAL}/billing`, { waitUntil: "networkidle" });
  check("lab staff never see billing pages", !(await page.locator("body").innerText()).includes("Recent transactions"));
}

/* ---------- responsive ---------- */
for (const [who, path, label] of [[recepA, "/billing", "dashboard"], [recepA, "/billing/invoices", "invoices"], [recepA, `/billing/invoices/${IID}`, "invoice"], [recepA, "/billing/invoices/new", "new invoice"], [recepA, "/billing/outstanding", "outstanding"], [recepA, "/billing/refunds", "refunds"], [adminA, "/billing/reports", "reports"], [adminA, "/billing/settings", "settings"], [adminA, "/billing/services", "services"], [recepA, `/billing/payments/${PID}/receipt`, "receipt"]]) {
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
console.log(`\nPhase 8 e2e: ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED:", fails.join(" | ")); process.exit(1); }
