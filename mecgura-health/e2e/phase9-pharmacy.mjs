/**
 * Live HTTP + browser checks for Phase 9 (medicine master, suppliers, purchases, batches, stock ledger, dispensing, FEFO, returns,
 * pharmacy billing, reports, documents, isolation). Run against a PRODUCTION build after `npm run db:seed`.  node e2e/phase9-pharmacy.mjs
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
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

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

const adminA = await login("admin@demo.mecgura.test"), mgrA = await login("pharmacymgr@demo.mecgura.test"), staffA = await login("pharmacy@demo.mecgura.test"), docA = await login("doctor@demo.mecgura.test"), recepA = await login("reception@demo.mecgura.test"), accA = await login("accountant@demo.mecgura.test"), labA = await login("lab@demo.mecgura.test");
const mgrB = await login("pharmacymgr@demob.mecgura.test"), staffB = await login("pharmacy@demob.mecgura.test");

/* ---------- access ---------- */
check("unauthenticated pharmacy API -> 401", (await fetch(`http://${LOCAL}/api/pharmacy/dashboard`)).status === 401);
check("reception, doctor and lab have no pharmacy dashboard", (await api(recepA, "GET", "/api/pharmacy/dashboard")).status === 403 && (await api(docA, "GET", "/api/pharmacy/dashboard")).status === 403 && (await api(labA, "GET", "/api/pharmacy/dashboard")).status === 403);
check("accountant has no pharmacy stock access", (await api(accA, "GET", "/api/pharmacy/medicines")).status === 403);
check("pharmacy staff can view but not create medicines, purchases or settings", (await api(staffA, "GET", "/api/pharmacy/medicines")).status === 200 && (await api(staffA, "POST", "/api/pharmacy/medicines", { genericName: "Nope" })).status === 403 && (await api(staffA, "POST", "/api/pharmacy/purchases", {})).status === 403 && (await api(staffA, "PUT", "/api/pharmacy/settings", { nearExpiryDays: 10, allowOverDispense: true, allowPatientReturns: true, returnWindowDays: 1 })).status === 403);
check("writes from another origin are refused (CSRF)", (await api(mgrA, "POST", "/api/pharmacy/medicines", { genericName: "Evil" }, "https://evil.example")).status === 403);
check("doctor can only see availability", (await api(docA, "GET", "/api/pharmacy/availability?q=zz")).status === 200 && (await api(docA, "GET", "/api/pharmacy/batches")).status === 403 && (await api(docA, "GET", "/api/pharmacy/suppliers")).status === 403);

/* ---------- master data ---------- */
const GEN = `E2eGeneric${stamp}`;
const mk = async (over = {}) => (await api(mgrA, "POST", "/api/pharmacy/medicines", { genericName: GEN, brandName: null, strength: "500 mg", dosageForm: "Tablet", manufacturer: "Synthetic Pharma", category: "Analgesic", unit: "tablet", reorderLevel: 10, minimumStock: 5, maximumStock: 200, purchasePriceMinor: 100, sellingPriceMinor: 200, taxRateBp: 500, ...over }));
const m1 = await mk(); const MED1 = m1.json?.data?.id;
check("manager creates a medicine with a tenant-scoped code", m1.status === 200 && /^MED-\d{6}$/.test(m1.json.data.medicineCode), m1.text);
check("medicine validation (price, tax, thresholds)", (await mk({ sellingPriceMinor: -5 })).status === 400 && (await mk({ taxRateBp: 20000 })).status === 400 && (await mk({ genericName: "" })).status === 400);
const sup = await api(mgrA, "POST", "/api/pharmacy/suppliers", { supplierName: `E2E Supplier ${stamp}`, phone: "9000000002" });
check("manager creates a supplier (SUP code)", sup.status === 200 && /^SUP-\d{6}$/.test(sup.json.data.supplierCode), sup.text);
const SUP = sup.json.data.id;
check("medicine search by generic name and by code", (await api(staffA, "GET", `/api/pharmacy/medicines?q=${GEN}`)).json.data.rows.some((r) => r.id === MED1) && (await api(staffA, "GET", `/api/pharmacy/medicines?q=${m1.json.data.medicineCode}`)).json.data.rows.some((r) => r.id === MED1));
check("clinic B can't find clinic A's medicine", (await api(mgrB, "GET", `/api/pharmacy/medicines?q=${GEN}`)).json.data.total === 0 && (await api(mgrB, "GET", `/api/pharmacy/medicines/${MED1}`)).status === 404);

/* ---------- purchase -> receive -> batches + ledger ---------- */
const FAR = daysFromNow(400), NEAR = daysFromNow(20);
const pur = await api(mgrA, "POST", "/api/pharmacy/purchases", { supplierId: SUP, supplierInvoiceNumber: `SI-${stamp}`, items: [{ medicineId: MED1, batchNumber: "E2E-LATE", expiryDate: FAR, quantity: 50, freeQuantity: 5, unitPurchasePriceMinor: 100, sellingPriceMinor: 200, taxRateBp: 500 }, { medicineId: MED1, batchNumber: "E2E-SOON", expiryDate: NEAR, quantity: 20, unitPurchasePriceMinor: 100, sellingPriceMinor: 200, taxRateBp: 500 }] });
check("manager saves a draft purchase (PUR number, server totals)", pur.status === 200 && /^PUR-\d{4}-\d{6}$/.test(pur.json.data.purchaseNumber), pur.text);
const PID = pur.json.data.id;
const pd = (await api(mgrA, "GET", `/api/pharmacy/purchases/${PID}`)).json.data;
check("purchase totals are integer minor units: 70×100 + 5% tax", pd.subtotalMinor === 7000 && pd.taxMinor === 350 && pd.totalMinor === 7350, JSON.stringify(pd));
check("a draft adds no stock", (await api(mgrA, "GET", `/api/pharmacy/batches?medicineId=${MED1}`)).json.data.total === 0);
check("pharmacy staff can't receive a purchase; duplicate supplier invoice is refused", (await api(staffA, "POST", `/api/pharmacy/purchases/${PID}/receive`)).status === 403 && (await api(mgrA, "POST", "/api/pharmacy/purchases", { supplierId: SUP, supplierInvoiceNumber: `SI-${stamp}`, items: [{ medicineId: MED1, batchNumber: "Z", expiryDate: FAR, quantity: 1, unitPurchasePriceMinor: 1, sellingPriceMinor: 1 }] })).status === 409);
check("clinic B can't see or receive A's purchase", (await api(mgrB, "GET", `/api/pharmacy/purchases/${PID}`)).status === 404 && (await api(mgrB, "POST", `/api/pharmacy/purchases/${PID}/receive`)).status === 404);
const rcv = await api(mgrA, "POST", `/api/pharmacy/purchases/${PID}/receive`);
check("manager receives the purchase", rcv.status === 200, rcv.text);
check("receiving twice is refused and adds nothing", (await api(mgrA, "POST", `/api/pharmacy/purchases/${PID}/receive`)).status === 409);
const batches = (await api(staffA, "GET", `/api/pharmacy/batches?medicineId=${MED1}`)).json.data.rows;
const late = batches.find((b) => b.batchNumber === "E2E-LATE"), soon = batches.find((b) => b.batchNumber === "E2E-SOON");
check("batches carry the supplier's batch number, expiry and received quantity (free units included)", late?.quantityAvailable === 55 && soon?.quantityAvailable === 20 && late.expiryDate === FAR);
check("near-expiry batch is flagged", soon.expiry === "NEAR_EXPIRY" && soon.daysRemaining === 20);
const bdet = (await api(staffA, "GET", `/api/pharmacy/batches/${late.id}`)).json.data;
check("ledger shows one PURCHASE row and is consistent", bdet.ledgerConsistent && bdet.transactions.length === 1 && bdet.transactions[0].type === "PURCHASE" && bdet.transactions[0].quantity === 55 && bdet.transactions[0].balanceAfter === 55);
check("complete purchase; invoice document renders", (await api(mgrA, "POST", `/api/pharmacy/purchases/${PID}/complete`)).status === 200);

/* ---------- opening stock, adjustments, damage, expiry ---------- */
const m2 = await mk({ genericName: `${GEN}Old` }); const MED2 = m2.json.data.id;
check("only the clinic admin can add opening stock", (await api(mgrA, "POST", "/api/pharmacy/stock/opening", { medicineId: MED2, batchNumber: "OLD-1", expiryDate: daysFromNow(-10), quantity: 12, purchasePriceMinor: 100, sellingPriceMinor: 200 })).status === 403);
const open = await api(adminA, "POST", "/api/pharmacy/stock/opening", { medicineId: MED2, batchNumber: "OLD-1", expiryDate: daysFromNow(-10), quantity: 12, purchasePriceMinor: 100, sellingPriceMinor: 200 });
check("admin adds opening stock (an expired batch stays visible)", open.status === 200, open.text);
const exp = (await api(mgrA, "GET", "/api/pharmacy/batches?state=expired")).json.data.rows.find((b) => b.batchNumber === "OLD-1");
check("expired batch is listed with negative days remaining", exp && exp.displayStatus === "EXPIRED" && exp.daysRemaining < 0);
check("adjustments: staff refused, reason + notes required, can't go below zero", (await api(staffA, "POST", "/api/pharmacy/stock/adjust", { batchId: late.id, direction: "OUT", quantity: 1, reason: "OTHER", notes: "x1" })).status === 403 && (await api(mgrA, "POST", "/api/pharmacy/stock/adjust", { batchId: late.id, direction: "OUT", quantity: 1, reason: "OTHER" })).status === 400 && (await api(mgrA, "POST", "/api/pharmacy/stock/adjust", { batchId: late.id, direction: "OUT", quantity: 999, reason: "OTHER", notes: "too many" })).status === 409);
check("adjustment out then in updates stock via the ledger", (await api(mgrA, "POST", "/api/pharmacy/stock/adjust", { batchId: late.id, direction: "OUT", quantity: 5, reason: "PHYSICAL_COUNT_CORRECTION", notes: "count short" })).json.data.balanceAfter === 50 && (await api(mgrA, "POST", "/api/pharmacy/stock/adjust", { batchId: late.id, direction: "IN", quantity: 5, reason: "DATA_CORRECTION", notes: "recounted" })).json.data.balanceAfter === 55);
check("damage and expired write-off", (await api(mgrA, "POST", "/api/pharmacy/stock/damage", { batchId: late.id, quantity: 1, reason: "Broken strip" })).status === 200 && (await api(mgrA, "POST", "/api/pharmacy/stock/expire", { batchId: late.id })).status === 409 && (await api(mgrA, "POST", "/api/pharmacy/stock/expire", { batchId: exp.id })).status === 200);
await api(mgrA, "POST", "/api/pharmacy/stock/adjust", { batchId: late.id, direction: "IN", quantity: 1, reason: "DATA_CORRECTION", notes: "restore the damaged unit for the test" });
const cnt = await api(mgrA, "POST", "/api/pharmacy/counts", { medicineId: MED1 });
check("physical count starts with system quantities", cnt.status === 200 && cnt.json.data.lines === 2, cnt.text);
const cd = (await api(mgrA, "GET", `/api/pharmacy/counts/${cnt.json.data.id}`)).json.data;
await api(mgrA, "PUT", `/api/pharmacy/counts/${cnt.json.data.id}`, { lines: cd.lines.map((l) => ({ batchId: l.batchId, physicalQuantity: l.systemQuantity })) });
check("a count with no differences applies nothing", (await api(mgrA, "POST", `/api/pharmacy/counts/${cnt.json.data.id}/apply`)).json.data.adjusted === 0);

/* ---------- prescription -> dispensing ---------- */
const doctorId = (await api(recepA, "GET", "/api/opd")).json.data.doctors[0].id;
async function finalizedRx(name, items) {
  await api(docA, "GET", "/api/opd");
  const reg = await api(recepA, "POST", "/api/opd", { patient: { newPatient: { name, phone: `98765${Math.floor(10000 + Math.random() * 89999)}`, gender: "FEMALE", dateOfBirth: "1990-01-01" }, allowDuplicate: true }, doctorUserId: doctorId });
  const visitId = reg.json.data.id; await api(docA, "POST", `/api/opd/${visitId}`, { action: "call" });
  const st = await api(docA, "POST", "/api/consultations/start", { visitId }); const cid = st.json.data.id;
  const got = (await api(docA, "GET", `/api/consultations/${cid}`)).json.data;
  await api(docA, "PATCH", `/api/consultations/${cid}`, { rev: got.rev, chiefComplaints: [{ text: "Cough", duration: "3 days" }], clinicalNotes: "Private clinical note" });
  const sv = await api(docA, "PUT", `/api/consultations/${cid}/prescription`, { items });
  await api(docA, "POST", `/api/consultations/${cid}/action`, { action: "review" });
  const fin = await api(docA, "POST", `/api/consultations/${cid}/action`, { action: "finalize", confirm: true });
  const g = (await api(docA, "GET", `/api/consultations/${cid}`)).json.data;
  return { cid, patientId: g.patientId, rxId: g.prescription?.id, number: g.prescription?.number, ok: sv.status === 200 && fin.status === 200 && g.prescription?.status === "FINALIZED", detail: sv.text + fin.text };
}
const item = (name, quantity, over = {}) => ({ name, strength: "500 mg", dose: "1 tablet", frequency: "Twice daily", morning: true, night: true, foodTiming: "AFTER_FOOD", durationDays: 5, quantity, instructions: "Take with water", ...over });
const rx1 = await finalizedRx("E2E Pharm Patient", [item(GEN, 60)]);
check("doctor finalizes a prescription (Phase 5)", rx1.ok && /^RX-/.test(rx1.number ?? ""), rx1.detail);
const queue = (await api(staffA, "GET", `/api/pharmacy/queue?status=PENDING&q=E2E Pharm Patient`)).json.data;
check("the finalized prescription appears in the pharmacy queue", queue.rows.some((r) => r.id === rx1.rxId));
rx1.patientId = queue.rows.find((r) => r.id === rx1.rxId)?.patientId;
check("clinic B's pharmacy never sees it", !(await api(staffB, "GET", "/api/pharmacy/queue?status=all")).json.data.rows.some((r) => r.id === rx1.rxId) && (await api(staffB, "GET", `/api/pharmacy/prescriptions/${rx1.rxId}`)).status === 404);
const view = (await api(staffA, "GET", `/api/pharmacy/prescriptions/${rx1.rxId}`)).json.data;
check("dispensing view: prescribed 60, exact-match medicine, FEFO order (soonest expiry first), no clinical notes", view.lines[0].prescribedUnits === 60 && view.lines[0].medicines[0].id === MED1 && view.lines[0].medicines[0].batches[0].batchNumber === "E2E-SOON" && !JSON.stringify(view).includes("Private clinical note"), JSON.stringify(view.lines[0].medicines.map((m) => m.batches)));
const ln = view.lines[0].prescriptionItemId;
check("reception/doctor/lab can't dispense", (await api(recepA, "POST", `/api/pharmacy/prescriptions/${rx1.rxId}/dispense`, { idempotencyKey: rnd(), items: [{ prescriptionItemId: ln, medicineId: MED1, quantity: 1 }] })).status === 403 && (await api(docA, "POST", `/api/pharmacy/prescriptions/${rx1.rxId}/dispense`, { idempotencyKey: rnd(), items: [{ prescriptionItemId: ln, medicineId: MED1, quantity: 1 }] })).status === 403);
check("a medicine that doesn't match the prescription is refused (no substitution)", (await api(staffA, "POST", `/api/pharmacy/prescriptions/${rx1.rxId}/dispense`, { idempotencyKey: rnd(), items: [{ prescriptionItemId: ln, medicineId: MED2, quantity: 1 }] })).status === 400);
check("bad quantities are refused", (await api(staffA, "POST", `/api/pharmacy/prescriptions/${rx1.rxId}/dispense`, { idempotencyKey: rnd(), items: [{ prescriptionItemId: ln, medicineId: MED1, quantity: -3 }] })).status === 400 && (await api(staffA, "POST", `/api/pharmacy/prescriptions/${rx1.rxId}/dispense`, { idempotencyKey: rnd(), items: [{ prescriptionItemId: ln, medicineId: MED1, quantity: 0 }] })).status === 400);
check("insufficient stock is refused (only 75 in stock, 60 prescribed → 80 is both)", (await api(staffA, "POST", `/api/pharmacy/prescriptions/${rx1.rxId}/dispense`, { idempotencyKey: rnd(), items: [{ prescriptionItemId: ln, medicineId: MED1, quantity: 80 }] })).status === 400);
const K1 = rnd();
const d1 = await api(staffA, "POST", `/api/pharmacy/prescriptions/${rx1.rxId}/dispense`, { idempotencyKey: K1, items: [{ prescriptionItemId: ln, medicineId: MED1, quantity: 30 }] });
check("partial dispense of 30 (FEFO: 20 soon + 10 late)", d1.status === 200 && /^DSP-\d{4}-\d{6}$/.test(d1.json.data.dispensingNumber) && !!d1.json.data.invoiceId, d1.text);
const D1 = d1.json.data.id;
const dd = (await api(staffA, "GET", `/api/pharmacy/dispensings/${D1}`)).json.data;
check("dispensing is PARTIALLY_DISPENSED with a batch split and price snapshot", dd.status === "PARTIALLY_DISPENSED" && dd.items.length === 2 && dd.items[0].batchNumber === "E2E-SOON" && dd.items[0].dispensedQuantity === 20 && dd.items[1].dispensedQuantity === 10 && dd.items[0].unitPriceMinor === 200 && dd.totalMinor === 6300, JSON.stringify(dd.items));
check("replaying the same request key is idempotent", (await api(staffA, "POST", `/api/pharmacy/prescriptions/${rx1.rxId}/dispense`, { idempotencyKey: K1, items: [{ prescriptionItemId: ln, medicineId: MED1, quantity: 30 }] })).json.data.duplicate === true);
const after = (await api(staffA, "GET", `/api/pharmacy/batches?medicineId=${MED1}`)).json.data.rows;
check("stock deducted exactly once (20 + 10)", after.find((b) => b.batchNumber === "E2E-SOON").quantityAvailable === 0 && after.find((b) => b.batchNumber === "E2E-LATE").quantityAvailable === 45);
const rxv = (await api(staffA, "GET", `/api/pharmacy/prescriptions/${rx1.rxId}`)).json.data;
check("prescription shows 30 remaining; the doctor's quantity is unchanged", rxv.lines[0].remainingUnits === 30 && rxv.lines[0].quantity === 60 && rxv.overallStatus === "PARTIALLY_DISPENSED");
const doctorView = (await api(docA, "GET", `/api/consultations/${rx1.cid}`)).json.data.prescription;
check("Phase 5: prescription status and version untouched by dispensing", doctorView.status === "FINALIZED" && doctorView.currentVersion === 1 && doctorView.items[0].quantity === 60);
check("over-dispensing the prescription is refused", (await api(staffA, "POST", `/api/pharmacy/prescriptions/${rx1.rxId}/dispense`, { idempotencyKey: rnd(), items: [{ prescriptionItemId: ln, medicineId: MED1, quantity: 31 }] })).status === 400);
const inv = (await api(accA, "GET", `/api/billing/invoices/${d1.json.data.invoiceId}`)).json.data;
check("Phase 8: an ISSUED pharmacy invoice exists with MEDICINE lines and tax", inv.status === "ISSUED" && inv.totalMinor === 6300 && inv.items.length === 2 && inv.items.every((i) => i.sourceType === "MEDICINE") && inv.taxMinor === 300, JSON.stringify(inv).slice(0, 400));
check("the accountant collects payment on it through Billing", (await api(accA, "POST", `/api/billing/invoices/${d1.json.data.invoiceId}/payments`, { amountMinor: 6300, method: "CASH", idempotencyKey: rnd() })).status === 200 && (await api(accA, "GET", `/api/billing/invoices/${d1.json.data.invoiceId}`)).json.data.status === "PAID");
check("a paid dispensing can't be cancelled; staff can't cancel at all", (await api(mgrA, "POST", `/api/pharmacy/dispensings/${D1}/cancel`, { reason: "Wrong patient" })).status === 409 && (await api(staffA, "POST", `/api/pharmacy/dispensings/${D1}/cancel`, { reason: "Wrong patient" })).status === 403);
const pat360 = (await api(docA, "GET", `/api/patients/${rx1.patientId}/pharmacy`));
check("Patient 360 pharmacy history for the doctor; reception is refused", pat360.status === 200 && pat360.json.data.rows[0].status === "PARTIALLY_DISPENSED" && (await api(recepA, "GET", `/api/patients/${rx1.patientId}/pharmacy`)).status === 403);
const tl = (await api(docA, "GET", `/api/patients/${rx1.patientId}/timeline?filter=pharmacy`)).json.data;
check("patient timeline has a pharmacy event", tl.events.some((e) => e.category === "pharmacy"), JSON.stringify(tl).slice(0, 200));

/* ---------- concurrency ---------- */
const mc = await mk({ genericName: `${GEN}Race` }); const MEDC = mc.json.data.id;
const pc = await api(mgrA, "POST", "/api/pharmacy/purchases", { supplierId: SUP, items: [{ medicineId: MEDC, batchNumber: "RACE-1", expiryDate: FAR, quantity: 10, unitPurchasePriceMinor: 100, sellingPriceMinor: 200 }] }); await api(mgrA, "POST", `/api/pharmacy/purchases/${pc.json.data.id}/receive`);
const rxa = await finalizedRx("E2E Race A", [item(`${GEN}Race`, 8)]), rxb = await finalizedRx("E2E Race B", [item(`${GEN}Race`, 8)]);
const lnA = (await api(staffA, "GET", `/api/pharmacy/prescriptions/${rxa.rxId}`)).json.data.lines[0].prescriptionItemId, lnB = (await api(staffA, "GET", `/api/pharmacy/prescriptions/${rxb.rxId}`)).json.data.lines[0].prescriptionItemId;
const race = await Promise.all([api(staffA, "POST", `/api/pharmacy/prescriptions/${rxa.rxId}/dispense`, { idempotencyKey: rnd(), items: [{ prescriptionItemId: lnA, medicineId: MEDC, quantity: 8 }] }), api(mgrA, "POST", `/api/pharmacy/prescriptions/${rxb.rxId}/dispense`, { idempotencyKey: rnd(), items: [{ prescriptionItemId: lnB, medicineId: MEDC, quantity: 8 }] })]);
check("two staff, same stock: exactly one succeeds", race.filter((r) => r.status === 200).length === 1 && race.filter((r) => r.status >= 400).length === 1, race.map((r) => `${r.status}`).join(","));
const rb = (await api(mgrA, "GET", `/api/pharmacy/batches?medicineId=${MEDC}`)).json.data.rows[0];
check("no negative stock after the race (10 - 8 = 2)", rb.quantityAvailable === 2);
const rxc = await finalizedRx("E2E Race C", [item(`${GEN}Race`, 2)]); const lnC = (await api(staffA, "GET", `/api/pharmacy/prescriptions/${rxc.rxId}`)).json.data.lines[0].prescriptionItemId; const KC = rnd();
const same = await Promise.all([1, 2].map(() => api(staffA, "POST", `/api/pharmacy/prescriptions/${rxc.rxId}/dispense`, { idempotencyKey: KC, items: [{ prescriptionItemId: lnC, medicineId: MEDC, quantity: 2 }] })));
check("the same request sent twice at once dispenses once", same.every((r) => r.status === 200) && same[0].json.data.id === same[1].json.data.id && (await api(mgrA, "GET", `/api/pharmacy/batches?medicineId=${MEDC}`)).json.data.rows[0].quantityAvailable === 0);
check("ledger still reconciles in both clinics", (await api(mgrA, "GET", "/api/pharmacy/stock/reconcile")).json.data.mismatches.length === 0 && (await api(mgrB, "GET", "/api/pharmacy/stock/reconcile")).json.data.mismatches.length === 0);

/* ---------- cancel an unpaid dispensing ---------- */
const rxd = await finalizedRx("E2E Cancel", [item(GEN, 5)]); const lnD = (await api(staffA, "GET", `/api/pharmacy/prescriptions/${rxd.rxId}`)).json.data.lines[0].prescriptionItemId;
const dd2 = await api(staffA, "POST", `/api/pharmacy/prescriptions/${rxd.rxId}/dispense`, { idempotencyKey: rnd(), items: [{ prescriptionItemId: lnD, medicineId: MED1, quantity: 5 }] });
const beforeCancel = (await api(mgrA, "GET", `/api/pharmacy/batches?medicineId=${MED1}`)).json.data.rows.reduce((a, b) => a + b.quantityAvailable, 0);
check("manager cancels an unpaid dispensing: stock returns, bill cancelled", (await api(mgrA, "POST", `/api/pharmacy/dispensings/${dd2.json.data.id}/cancel`, { reason: "Entered for the wrong patient" })).status === 200 && (await api(mgrA, "GET", `/api/pharmacy/batches?medicineId=${MED1}`)).json.data.rows.reduce((a, b) => a + b.quantityAvailable, 0) === beforeCancel + 5 && (await api(accA, "GET", `/api/billing/invoices/${dd2.json.data.invoiceId}`)).json.data.status === "CANCELLED");

/* ---------- returns ---------- */
check("returns are refused while clinic policy says no", (await api(staffA, "POST", "/api/pharmacy/returns", { type: "PATIENT_RETURN", dispensingItemId: dd.items[0].id, quantity: 1, reason: "Not needed" })).status === 409);
check("admin enables patient returns", (await api(adminA, "PUT", "/api/pharmacy/settings", { nearExpiryDays: 90, allowOverDispense: false, allowPatientReturns: true, returnWindowDays: 7, billFooter: "Thank you" })).status === 200);
const ret = await api(staffA, "POST", "/api/pharmacy/returns", { type: "PATIENT_RETURN", dispensingItemId: dd.items[1].id, quantity: 4, reason: "Prescription changed" });
check("staff requests a return (RET number)", ret.status === 200 && /^RET-\d{4}-\d{6}$/.test(ret.json.data.returnNumber), ret.text);
const RID = ret.json.data.id; const stockBefore = (await api(mgrA, "GET", `/api/pharmacy/batches?medicineId=${MED1}`)).json.data.rows.find((b) => b.batchNumber === "E2E-LATE").quantityAvailable;
check("staff can't approve; manager approves then receives with a condition", (await api(staffA, "POST", `/api/pharmacy/returns/${RID}/action`, { action: "approve" })).status === 403 && (await api(mgrA, "POST", `/api/pharmacy/returns/${RID}/action`, { action: "approve" })).status === 200 && (await api(mgrA, "POST", `/api/pharmacy/returns/${RID}/action`, { action: "receive" })).status === 400 && (await api(mgrA, "POST", `/api/pharmacy/returns/${RID}/action`, { action: "receive", condition: "SEALED" })).status === 200);
check("received medicine is not sellable yet", (await api(mgrA, "GET", `/api/pharmacy/batches?medicineId=${MED1}`)).json.data.rows.find((b) => b.batchNumber === "E2E-LATE").quantityAvailable === stockBefore);
check("restock puts it back through the ledger", (await api(mgrA, "POST", `/api/pharmacy/returns/${RID}/action`, { action: "restock" })).status === 200 && (await api(mgrA, "GET", `/api/pharmacy/batches?medicineId=${MED1}`)).json.data.rows.find((b) => b.batchNumber === "E2E-LATE").quantityAvailable === stockBefore + 4);
const bl = (await api(mgrA, "GET", `/api/pharmacy/batches?medicineId=${MED1}`)).json.data.rows.find((b) => b.batchNumber === "E2E-LATE");
const pr = await api(mgrA, "POST", "/api/pharmacy/returns/supplier", { supplierId: SUP, batchId: bl.id, quantity: 2, reason: "Wrong strength", reference: "CN-1" });
check("purchase return takes stock back to the supplier", pr.status === 200 && (await api(mgrA, "GET", `/api/pharmacy/batches/${bl.id}`)).json.data.transactions.some((t) => t.type === "PURCHASE_RETURN" && t.quantity === -2) && (await api(staffA, "POST", "/api/pharmacy/returns/supplier", { supplierId: SUP, batchId: bl.id, quantity: 1, reason: "no" })).status === 403);

/* ---------- block, low stock, price audit ---------- */
check("blocking a batch stops dispensing from it", (await api(mgrA, "POST", `/api/pharmacy/batches/${bl.id}/block`, { block: true, reason: "Recall notice" })).status === 200 && (await api(staffA, "GET", `/api/pharmacy/prescriptions/${rx1.rxId}`)).json.data.lines[0].medicines[0].available === 0);
await api(mgrA, "POST", `/api/pharmacy/batches/${bl.id}/block`, { block: false });
const low = await mk({ genericName: `${GEN}Low`, reorderLevel: 50 });
check("a medicine with no stock is out of stock; the filter finds it", (await api(staffA, "GET", `/api/pharmacy/medicines?status=out&q=${GEN}Low`)).json.data.rows.some((r) => r.id === low.json.data.id));
check("price change needs a reason and is audited (old and new)", (await api(mgrA, "PUT", `/api/pharmacy/medicines/${MED1}`, { genericName: GEN, strength: "500 mg", unit: "tablet", reorderLevel: 10, minimumStock: 5, maximumStock: 200, purchasePriceMinor: 100, sellingPriceMinor: 250, taxRateBp: 500 })).status === 400 && (await api(mgrA, "PUT", `/api/pharmacy/medicines/${MED1}`, { genericName: GEN, strength: "500 mg", unit: "tablet", reorderLevel: 10, minimumStock: 5, maximumStock: 200, purchasePriceMinor: 100, sellingPriceMinor: 250, taxRateBp: 500, priceChangeReason: "MRP revised" })).status === 200);
check("old dispensing keeps its original price after the master changed", (await api(staffA, "GET", `/api/pharmacy/dispensings/${D1}`)).json.data.items[0].unitPriceMinor === 200);

/* ---------- reports, ledger, documents ---------- */
for (const k of ["stock_summary", "stock_ledger", "purchases", "dispensing", "expiry", "low_stock", "medicine_sales", "supplier_purchases", "adjustments", "returns"]) check(`report ${k} runs`, (await api(mgrA, "GET", `/api/pharmacy/reports?kind=${k}`)).status === 200);
check("reports and CSV export are manager-only", (await api(staffA, "GET", "/api/pharmacy/reports?kind=stock_summary")).status === 403 && (await api(staffA, "GET", "/api/pharmacy/reports/export?kind=stock_summary")).status === 403);
const csv = await mgrA.ctx.request.get(`http://${LOCAL}/api/pharmacy/reports/export?kind=stock_summary`);
check("CSV export is private, labelled as cost, never cached", csv.status() === 200 && (csv.headers()["cache-control"] ?? "").includes("no-store") && (await csv.text()).includes("Stock value (cost)"));
check("ledger lists every movement with filters", (await api(staffA, "GET", `/api/pharmacy/ledger?medicineId=${MED1}&type=DISPENSE`)).json.data.rows.length >= 2);
const docRes = await staffA.ctx.request.get(`http://${LOCAL}/api/pharmacy/docs/bill/${D1}`, { failOnStatusCode: false });
const html = await docRes.text();
check("pharmacy bill: private download with clinic branding, no MECGURA, security headers", docRes.status() === 200 && html.includes("Demo Clinic") && !/mecgura/i.test(html.replace(/mecgura\.test/gi, "")) && (docRes.headers()["cache-control"] ?? "").includes("no-store") && (docRes.headers()["content-security-policy"] ?? "").includes("default-src 'none'"));
check("documents: anonymous 401, other clinic 404, wrong role 403", (await fetch(`http://${LOCAL}/api/pharmacy/docs/bill/${D1}`)).status === 401 && (await api(staffB, "GET", `/api/pharmacy/docs/bill/${D1}`)).status === 404 && (await api(recepA, "GET", `/api/pharmacy/docs/bill/${D1}`)).status === 403);
check("slip, purchase invoice and stock report render", (await staffA.ctx.request.get(`http://${LOCAL}/api/pharmacy/docs/slip/${D1}`)).status() === 200 && (await mgrA.ctx.request.get(`http://${LOCAL}/api/pharmacy/docs/purchase/${PID}`)).status() === 200 && (await mgrA.ctx.request.get(`http://${LOCAL}/api/pharmacy/docs/stock/current`)).status() === 200);

/* ---------- tenant isolation spot checks ---------- */
check("clinic B can't act on A's batches, dispensings or counts", (await api(mgrB, "POST", "/api/pharmacy/stock/adjust", { batchId: bl.id, direction: "OUT", quantity: 1, reason: "OTHER", notes: "cross tenant" })).status === 404 && (await api(mgrB, "GET", `/api/pharmacy/dispensings/${D1}`)).status === 404 && (await api(mgrB, "GET", `/api/pharmacy/counts/${cnt.json.data.id}`)).status === 404 && (await api(staffB, "GET", `/api/pharmacy/batches/${bl.id}`)).status === 404);
check("a tenantId sent from the browser is ignored", (await api(mgrB, "POST", "/api/pharmacy/medicines", { genericName: `Spoof${stamp}`, tenantId: "someone-else", unit: "tablet" })).status === 200 && !(await api(mgrA, "GET", `/api/pharmacy/medicines?q=Spoof${stamp}`)).json.data.rows.length);

/* ---------- UI ---------- */
{
  const { page, errors } = mgrA;
  await page.goto(`http://${LOCAL}/pharmacy`, { waitUntil: "networkidle" });
  check("dashboard: real tiles and quick actions", await page.getByRole("heading", { name: "Pharmacy", level: 1 }).isVisible() && await page.getByText("Total medicines").isVisible() && await page.getByText("Today's pharmacy sales").isVisible() && await page.getByRole("link", { name: /Purchase/ }).first().isVisible());
  check("dashboard states the stock-value method (cost, not profit)", await page.getByText(/not profit/i).first().isVisible());
  await page.goto(`http://${LOCAL}/pharmacy/medicines`, { waitUntil: "networkidle" });
  await page.getByLabel("Search medicines").fill(GEN); await page.getByRole("link", { name: new RegExp(GEN) }).first().waitFor({ timeout: 10000 });
  check("medicine list searches server-side", (await page.getByRole("link", { name: new RegExp(GEN) }).count()) >= 1);
  await page.getByRole("button", { name: "Add medicine" }).click();
  const dlg = page.getByRole("dialog"); await dlg.getByLabel(/^Generic name/).fill(`UiMed ${stamp}`); await dlg.getByLabel(/^Strength/).fill("10 mg"); await dlg.getByLabel(/^Selling price/).fill("12.50"); await dlg.getByRole("button", { name: "Save medicine" }).click();
  await page.waitForURL(/\/pharmacy\/medicines\/.+/, { timeout: 15000 }); await page.getByRole("tab", { name: /Batches/ }).waitFor({ timeout: 15000 });
  check("adding a medicine opens its detail page with batches, ledger and returns tabs", await page.getByRole("tab", { name: /Batches/ }).isVisible() && await page.getByRole("tab", { name: "Stock ledger" }).isVisible() && await page.getByRole("tab", { name: "Returns" }).isVisible() && await page.getByText(/MED-\d{6}/).first().isVisible());
  check("a medicine with no stock says so, and nothing is substituted", await page.getByText("Medicine unavailable").isVisible());
  await page.goto(`http://${LOCAL}/pharmacy/purchases/new`, { waitUntil: "networkidle" });
  await page.getByLabel(/^Medicine 1/).fill(`UiMed ${stamp}`); await page.getByRole("button", { name: new RegExp(`UiMed ${stamp}`) }).first().click();
  await page.getByRole("combobox", { name: /^Supplier(?! invoice)/ }).selectOption({ index: 1 }); await page.getByLabel(/^Batch number/).fill("UI-B1"); await page.getByLabel(/^Expiry date/).fill(FAR); await page.getByLabel(/^Quantity/).fill("25"); await page.getByLabel(/^Purchase price/).fill("8");
  check("purchase form shows server-style totals", await page.getByText("Grand total").isVisible());
  await page.getByRole("button", { name: "Save draft" }).click(); await page.waitForURL(/\/pharmacy\/purchases\/[^/]+$/, { timeout: 15000 });
  await page.getByRole("button", { name: "Receive purchase" }).click(); await page.getByRole("dialog").getByRole("button", { name: "Receive into stock" }).click();
  await page.getByText(/Purchase received/).first().waitFor({ timeout: 15000 });
  await page.getByRole("link", { name: "UI-B1" }).waitFor({ timeout: 15000 });
  check("receive purchase via the UI adds stock", await page.getByText("Received").first().isVisible() && await page.getByRole("link", { name: "UI-B1" }).isVisible());
  await page.getByRole("link", { name: "UI-B1" }).click(); await page.waitForURL(/\/pharmacy\/stock\/.+/, { timeout: 10000 });
  await page.getByText("Transaction history").waitFor({ timeout: 15000 });
  check("batch detail shows the transaction history", await page.getByText("Transaction history").isVisible() && await page.getByText("Purchase", { exact: true }).first().isVisible());
  await page.goto(`http://${LOCAL}/pharmacy/adjustments`, { waitUntil: "networkidle" });
  check("adjustments page offers stock adjustment and physical count", await page.getByText("Physical stock count").isVisible() && await page.getByRole("button", { name: "Start a count" }).isVisible());
  await page.goto(`http://${LOCAL}/pharmacy/expiry`, { waitUntil: "networkidle" });
  check("expired stock page lists expired batches with a Dispose action", await page.getByRole("button", { name: "Near expiry" }).isVisible());
  check("manager: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page, errors } = staffA;
  await finalizedRx("E2E UI Dispense", [item(GEN, 10)]);
  await page.goto(`http://${LOCAL}/pharmacy/dispensing`, { waitUntil: "networkidle" });
  await page.getByLabel("Search prescriptions").fill("E2E UI Dispense"); await page.getByRole("link", { name: "Dispense" }).first().waitFor({ timeout: 10000 });
  await page.getByRole("link", { name: "Dispense" }).first().click(); await page.waitForURL(/\/pharmacy\/dispensing\/.+/, { timeout: 10000 });
  await page.getByText(/read-only here/).waitFor({ timeout: 15000 }); await page.getByText(/Suggested:/).first().waitFor({ timeout: 15000 });
  check("dispensing screen shows the read-only prescription and FEFO suggestion", await page.getByText(/read-only here/).isVisible() && await page.getByText(/Suggested:/).first().isVisible() && await page.getByText("Patient").count() >= 0);
  await page.getByRole("button", { name: /Review/ }).click();
  const rd = page.getByRole("dialog"); await rd.getByText(/Confirm/).first().waitFor({ timeout: 10000 });
  await rd.getByRole("button", { name: /^(Dispense|Partial dispense)$/ }).click();
  await page.waitForURL(/\/pharmacy\/dispensed\/.+/, { timeout: 20000 }); await page.getByText(/DSP-\d{4}-\d{6}/).first().waitFor({ timeout: 15000 });
  check("dispensing via the UI creates the record and a pharmacy bill number", await page.getByText(/DSP-\d{4}-\d{6}/).first().isVisible() && await page.getByText(/INV-\d{4}-\d{6}/).first().isVisible());
  check("dispensing record offers bill, slip and (for staff) return, but no cancel", await page.getByRole("link", { name: "Pharmacy bill" }).isVisible() && await page.getByRole("link", { name: "Dispensing slip" }).isVisible() && (await page.getByRole("button", { name: "Cancel dispensing" }).count()) === 0);
  await page.getByRole("link", { name: "Pharmacy bill" }).click(); await page.waitForURL(/\/pharmacy\/docs\/bill\/.+/, { timeout: 10000 });
  check("pharmacy bill page renders with the clinic's name and a print button", await page.getByText("Demo Clinic").first().isVisible() && await page.getByRole("button", { name: "Print" }).isVisible());
  const pnav = page.getByRole("navigation", { name: "Pharmacy sections" });
  check("staff has no purchase / settings / reports in navigation", (await pnav.getByRole("link", { name: "Purchases" }).count()) === 0 && (await pnav.getByRole("link", { name: "Settings" }).count()) === 0 && (await pnav.getByRole("link", { name: "Reports" }).count()) === 0 && (await pnav.getByRole("link", { name: "Dispensing" }).count()) === 1);
  check("staff: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page, errors } = docA;
  await page.goto(`http://${LOCAL}/patients?q=E2E Pharm Patient`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /E2E Pharm Patient/ }).first().click(); await page.waitForURL(/\/patients\/.+/);
  await page.getByRole("tab", { name: "Pharmacy" }).click(); await page.getByText(/DSP-\d{4}-\d{6}/).first().waitFor({ timeout: 15000 });
  check("Patient 360 Pharmacy tab shows what was dispensed", await page.getByText(/DSP-\d{4}-\d{6}/).first().isVisible() && await page.getByText(/Partly dispensed/).first().isVisible());
  check("doctor: no console errors", errors.length === 0, errors.join(" | "));
}
/* responsive sweep: no horizontal overflow, mobile and desktop */
{
  const paths = ["/pharmacy", "/pharmacy/medicines", `/pharmacy/medicines/${MED1}`, "/pharmacy/stock", "/pharmacy/purchases", `/pharmacy/purchases/${PID}`, "/pharmacy/purchases/new", "/pharmacy/suppliers", "/pharmacy/dispensing", `/pharmacy/dispensing/${rx1.rxId}`, `/pharmacy/dispensed/${D1}`, "/pharmacy/returns", "/pharmacy/expiry", "/pharmacy/adjustments", "/pharmacy/ledger", "/pharmacy/reports", "/pharmacy/settings", `/pharmacy/docs/bill/${D1}`];
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } }); const p = await ctx.newPage();
  await p.goto(`http://${LOCAL}/login`); await p.fill("input[name=identifier]", "admin@demo.mecgura.test"); await p.fill("input[name=password]", PW); await p.click("button[type=submit]"); await p.waitForURL((u) => !u.pathname.startsWith("/login"));
  for (const w of [375, 1280]) {
    await p.setViewportSize({ width: w, height: 800 });
    for (const path of paths) { await p.goto(`http://${LOCAL}${path}`, { waitUntil: "networkidle" }); const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`no horizontal overflow at ${w}px: ${path.replace(/[a-z0-9]{20,}/g, ":id")}`, over <= 1, `overflow ${over}`); }
  }
  await ctx.close();
}

await browser.close();
console.log(`\nPhase 9 e2e: ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
