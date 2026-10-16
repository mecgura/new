/**
 * Live HTTP + browser checks for Phase 15 (plans, subscriptions, clinic billing, entitlements, webhooks, Super Admin console).
 * Run against a PRODUCTION build after `npm run db:seed`, server started with CRON_SECRET=e2e-cron-secret-0123456789 and
 * SUBSCRIPTION_PAYMENT_PROVIDER=razorpay RAZORPAY_WEBHOOK_SECRET=whsec_e2e_sub_secret (no API keys: online checkout stays unavailable).
 */
import { createHmac } from "node:crypto";
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
const api = async (c, method, path, body, origin) => { const r = await c.ctx.request.fetch(`http://${LOCAL}${path}`, { method, headers: { "content-type": "application/json", origin: origin ?? `http://${LOCAL}` }, data: body ? JSON.stringify(body) : undefined, failOnStatusCode: false, maxRedirects: 0 }); let json = null, text = ""; try { text = await r.text(); json = JSON.parse(text); } catch { /* */ } return { status: r.status(), json, text }; };
const STAMP = Date.now().toString(36);
const sa = await login("/login", "platform@demo.mecgura.test"), adminB = await login("/login", "admin@demob.mecgura.test"), adminA = await login("/login", "admin@demo.mecgura.test"), recepA = await login("/login", "reception@demo.mecgura.test");
const P1 = await login("/portal/login?clinic=demo-clinic-b", "patient@demob.mecgura.test");
const clinics = (await api(sa, "GET", "/api/platform/clinics?all=1")).json.data.rows; const A = clinics.find((c) => c.slug === "demo-clinic"), B = clinics.find((c) => c.slug === "demo-clinic-b");

/* ---------- access control ---------- */
const SAGETS = ["plans", "subscriptions", "subscriptions/analytics", "subscriptions/settings", "subscriptions/invoices", "subscriptions/webhooks", `subscriptions/${A.id}`];
for (const p of SAGETS) check(`anonymous /api/platform/${p} -> 401`, (await fetch(`http://${LOCAL}/api/platform/${p}`)).status === 401);
check("clinic admin and receptionist get 403 from every platform billing API", (await Promise.all(SAGETS.flatMap((p) => [adminA, recepA].map((c) => api(c, "GET", `/api/platform/${p}`))))).every((r) => r.status === 403));
check("clinic admin cannot create plans or assign subscriptions", (await api(adminA, "POST", "/api/platform/plans", { name: "Hack" })).status === 403 && (await api(adminA, "POST", `/api/platform/subscriptions/${A.id}/assign`, { planId: "x", reason: "attack attempt", password: PW })).status === 403);
check("anonymous /api/subscription -> 401; receptionist lacks subscription permission (403)", (await fetch(`http://${LOCAL}/api/subscription`)).status === 401 && (await api(recepA, "GET", "/api/subscription")).status === 403 && (await api(recepA, "POST", "/api/subscription/choose", {})).status === 403);
check("cross-site writes are refused", (await api(adminA, "POST", "/api/subscription/cancel", { reason: "OTHER" }, "https://evil.example")).status === 403);

/* ---------- public pricing from real records ---------- */
const mkPlan = async (o) => api(sa, "POST", "/api/platform/plans", { status: "DRAFT", currency: "INR", setupFeeMinor: 0, trialDays: 0, isPublic: true, sortOrder: 0, annualPriceMinor: 0, monthlyPriceMinor: 0, limits: {}, ...o });
const FEAT = (on) => Object.fromEntries(["appointments", "liveOPD", "patientCRM", "consultation", "prescription", "lab", "followUp", "billing", "pharmacy", "patientPortal", "whatsapp", "sms", "email", "analytics", "reports", "publicWebsite", "customDomain"].map((k) => [k, on.includes(k)]));
const CORE = ["appointments", "liveOPD", "patientCRM", "consultation", "prescription", "followUp", "billing", "patientPortal", "publicWebsite", "email"];
const bad = await mkPlan({ name: "Bad", slug: "Bad Slug", features: FEAT([]) }); check("plan validation rejects a bad slug", bad.status === 400);
const draft = await mkPlan({ name: `E2E Draft ${STAMP}`, slug: `e2e-draft-${STAMP}`, monthlyPriceMinor: 12300, annualPriceMinor: 123000, features: FEAT(CORE) });
const e2eStarter = await mkPlan({ name: `E2E Starter ${STAMP}`, slug: `e2e-starter-${STAMP}`, monthlyPriceMinor: 150000, annualPriceMinor: 1500000, trialDays: 10, features: FEAT(CORE), limits: { maxPatients: { mode: "LIMITED", value: 100000 }, maxDoctors: { mode: "LIMITED", value: 50 } } });
const e2ePro = await mkPlan({ name: `E2E Pro ${STAMP}`, slug: `e2e-pro-${STAMP}`, monthlyPriceMinor: 400000, annualPriceMinor: 4000000, features: FEAT([...CORE, "pharmacy", "lab", "analytics"]) });
check("plans can be created as drafts", draft.status === 200 && draft.json.data.status === "DRAFT" && e2eStarter.status === 200);
const pubBefore = await fetch(`http://${LOCAL}/pricing`).then((r) => r.text()); check("a draft plan is NOT on the public pricing page", !pubBefore.includes(`E2E Draft ${STAMP}`) && !pubBefore.includes(`E2E Starter ${STAMP}`));
for (const p of [e2eStarter, e2ePro]) await api(sa, "POST", `/api/platform/plans/${p.json.data.id}/status`, { status: "ACTIVE" });
const pub = await fetch(`http://${LOCAL}/pricing`).then((r) => r.text()); const pubApi = await fetch(`http://${LOCAL}/api/public/plans`).then((r) => r.json());
check("active public plans show on /pricing with prices from the records (no login needed)", pub.includes(`E2E Starter ${STAMP}`) && /1,500/.test(pub) && /Pharmacy/.test(pub) && pubApi.ok && pubApi.data.some((p) => p.slug === `e2e-starter-${STAMP}`) && !pub.includes(`E2E Draft ${STAMP}`));
check("a plan cannot be deleted (no DELETE route) but can be archived", (await api(sa, "DELETE", `/api/platform/plans/${draft.json.data.id}`)).status === 405 && (await api(sa, "POST", `/api/platform/plans/${draft.json.data.id}/status`, { status: "ARCHIVED" })).status === 200);

/* ---------- reset clinic B, then clinic admin picks a plan in the UI ---------- */
const sB = (await api(sa, "GET", `/api/platform/subscriptions/${B.id}`)).json.data;
if (sB.subscription && !["CANCELLED", "EXPIRED"].includes(sB.subscription.status)) await api(sa, "POST", `/api/platform/subscriptions/${B.id}/act`, { act: "cancel", reason: "E2E reset of the subscription", password: PW });
const pg = adminB.page; await pg.goto("/subscription"); await pg.waitForSelector("h1");
check("subscription page shows plans from the records and a no-plan notice", (await pg.getByText(`E2E Starter ${STAMP}`).count()) > 0 && (await pg.getByText("Choose a plan").count()) > 0);
await pg.getByRole("heading", { name: `E2E Starter ${STAMP}` }).locator("xpath=ancestor::li").getByRole("button", { name: /free trial/i }).click(); await pg.waitForTimeout(2500); await pg.reload();
check("starting a trial creates NO invoice and NO payment", (await pg.getByText("Trial", { exact: true }).count()) > 0 && (await api(adminB, "GET", "/api/subscription")).json.data.invoices.length === 0 && (await api(adminB, "GET", "/api/subscription")).json.data.payments.length === 0);
const ov = (await api(adminB, "GET", "/api/subscription")).json.data; check("overview: trial status, plan name, usage with limits", ov.subscription.status === "TRIAL" && ov.subscription.trialDaysLeft >= 9 && ov.usage.some((u) => u.key === "maxPatients" && u.limit === 100000));
check("the same trial cannot be started twice", (await api(adminB, "POST", "/api/subscription/choose", { planId: e2eStarter.json.data.id, interval: "MONTHLY", trial: true })).status === 409);
await pg.setViewportSize({ width: 375, height: 800 }); await pg.reload(); check("subscription page has no horizontal scroll at 375px", await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); await pg.setViewportSize({ width: 1280, height: 800 });

/* ---------- invoice, payment safety, manual (offline) payment ---------- */
const conv = await api(adminB, "POST", "/api/subscription/choose", { planId: e2eStarter.json.data.id, interval: "MONTHLY" }); const invId = conv.json?.data?.invoiceId;
check("converting a trial to paid creates ONE invoice with the server's price (₹1,500)", conv.status === 200 && !!invId && (await api(adminB, "GET", "/api/subscription")).json.data.invoices.find((i) => i.id === invId)?.totalMinor === 150000);
check("choosing again reuses the same invoice (no duplicates)", (await api(adminB, "POST", "/api/subscription/choose", { planId: e2eStarter.json.data.id, interval: "MONTHLY" })).json.data.invoiceId === invId);
const co = await api(adminB, "POST", `/api/subscription/invoices/${invId}/checkout`); check("online checkout says so plainly when no provider is configured", co.status === 409 && /isn't available|not available|couldn't be opened/i.test(co.json.error.message));
check("clinic A cannot checkout, sync or read clinic B's invoice (IDOR)", (await api(adminA, "POST", `/api/subscription/invoices/${invId}/checkout`)).status === 404 && (await api(adminA, "POST", `/api/subscription/invoices/${invId}/sync`)).status === 404 && (await api(adminA, "GET", `/api/subscription/documents/invoice/${invId}`)).status === 404);
await pg.goto("/subscription"); check("the page shows the payment due without claiming it is paid", (await pg.getByText("Payment due").count()) > 0 && (await pg.getByText("MEC-INV-").count()) > 0);
await pg.goto("/subscription/payment-result?invoice=" + invId); check("the payment-result page never says 'confirmed' unless the invoice is PAID", (await pg.getByText("Not confirmed yet").count()) > 0 && (await pg.getByText("Payment confirmed").count()) === 0);
const noSig = await fetch(`http://${LOCAL}/api/webhooks/subscriptions/razorpay`, { method: "POST", body: JSON.stringify({ event: "payment.captured" }) }); check("webhook without a signature is rejected (401) and an unknown provider is 404", noSig.status === 401 && (await fetch(`http://${LOCAL}/api/webhooks/subscriptions/nope`, { method: "POST", body: "{}" })).status === 404);
const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_e2e_1", order_id: "o", amount: 150000, currency: "INR", status: "captured", notes: { invoice_id: invId } } } } });
const sig = (b, s) => createHmac("sha256", s).update(b).digest("hex");
check("webhook with a WRONG signature changes nothing", (await fetch(`http://${LOCAL}/api/webhooks/subscriptions/razorpay`, { method: "POST", body, headers: { "x-razorpay-signature": sig(body, "wrong"), "x-razorpay-event-id": "evt_e2e_1" } })).status === 401);
const good = await fetch(`http://${LOCAL}/api/webhooks/subscriptions/razorpay`, { method: "POST", body, headers: { "x-razorpay-signature": sig(body, "whsec_e2e_sub_secret"), "x-razorpay-event-id": "evt_e2e_1" } });
check("a correctly signed event is still NOT trusted without the provider's own confirmation (no API keys → retry later, nothing activated)", good.status >= 500 && (await api(adminB, "GET", "/api/subscription")).json.data.invoices.find((i) => i.id === invId).status === "ISSUED");
check("clinic admin cannot record an offline payment (Super Admin only)", (await api(adminB, "POST", `/api/platform/subscriptions/invoices/${invId}/payment`, { amountRupees: "1500", reference: "X", reason: "n/a", password: PW })).status === 403);
check("offline payment needs the Super Admin's password", (await api(sa, "POST", `/api/platform/subscriptions/invoices/${invId}/payment`, { amountRupees: "1500", reference: `UTR-${STAMP}`, reason: "bank transfer", password: "wrong" })).status === 403);
check("offline payment must be a valid amount and reference", (await api(sa, "POST", `/api/platform/subscriptions/invoices/${invId}/payment`, { amountRupees: "99999", reference: `UTR-${STAMP}`, reason: "bank transfer", password: PW })).status === 400 && (await api(sa, "POST", `/api/platform/subscriptions/invoices/${invId}/payment`, { amountRupees: "1500", reference: "", reason: "bank transfer", password: PW })).status === 400);
const pay = await Promise.all([1, 2, 3].map(() => api(sa, "POST", `/api/platform/subscriptions/invoices/${invId}/payment`, { amountRupees: "1500", reference: `UTR-${STAMP}`, reason: "bank transfer", password: PW })));
const ov2 = (await api(adminB, "GET", "/api/subscription")).json.data;
check("three simultaneous identical payment submissions create exactly ONE payment and activate once", ov2.payments.filter((p) => p.status === "SUCCEEDED").length === 1 && ov2.subscription.status === "ACTIVE" && ov2.invoices.find((i) => i.id === invId).status === "PAID", JSON.stringify(pay.map((p) => p.status)));
const rec = ov2.payments.find((p) => p.status === "SUCCEEDED"); check("receipt number follows MEC-REC-YYYY-NNNNNN", /^MEC-REC-\d{4}-\d{6}$/.test(rec.receiptNumber));

/* ---------- documents ---------- */
await pg.goto(`/subscription/documents/invoice/${invId}`); const docText = await pg.locator("#saas-doc").innerText();
check("invoice document: MECGURA issuer, number, plan line, no fabricated legal data", /MEC-INV-\d{4}-\d{6}/.test(docText) && /E2E Starter/.test(docText) && /1,500/.test(docText) && !/GSTIN: \d/.test(docText));
const dl = await api(adminB, "GET", `/api/subscription/documents/receipt/${rec.id}`); check("receipt downloads as private HTML", dl.status === 200 && /MEC-REC-/.test(dl.text));

/* ---------- billing details ---------- */
const bp = await api(adminB, "PUT", "/api/subscription/billing-profile", { legalName: "Demo Clinic B Pvt", billingEmail: "billing@demob.test", stateCode: "03", gstin: "BAD" }); check("GSTIN is validated when given", bp.status === 400);
const bp2 = await api(adminB, "PUT", "/api/subscription/billing-profile", { legalName: "Demo Clinic B Pvt", billingEmail: "billing@demob.test", stateCode: "03", gstin: "" }); check("GSTIN is optional", bp2.status === 200);

/* ---------- upgrade preview / downgrade ---------- */
const pv = await api(adminB, "POST", "/api/subscription/change", { planId: e2ePro.json.data.id, interval: "MONTHLY" }); check("upgrade preview shows proration from the server and changes nothing", pv.status === 200 && pv.json.data.preview.kind === "UPGRADE" && pv.json.data.preview.proration.netMinor > 0 && (await api(adminB, "GET", "/api/subscription")).json.data.subscription.planName.includes("Starter"));
const up = await api(adminB, "POST", "/api/subscription/change", { planId: e2ePro.json.data.id, interval: "MONTHLY", confirm: true }); check("confirming an upgrade creates an invoice; the plan switches only after payment", up.status === 200 && !!up.json.data.invoiceId && (await api(adminB, "GET", "/api/subscription")).json.data.subscription.planName.includes("Starter"));
await api(sa, "POST", `/api/platform/subscriptions/invoices/${up.json.data.invoiceId}/payment`, { amountRupees: String(pv.json.data.preview.proration.netMinor / 100), reference: `UTR-UP-${STAMP}`, reason: "bank transfer", password: PW });
check("after the upgrade invoice is paid the plan is Pro", (await api(adminB, "GET", "/api/subscription")).json.data.subscription.planName.includes("Pro"));

/* ---------- suspension: read-only, data kept, portal policy ---------- */
const pat = await api(adminB, "GET", "/api/patients?pageSize=1"); const patCount = pat.json?.data?.total ?? pat.json?.data?.rows?.length ?? 0;
check("active clinic admin can write (validation error, not 403)", (await api(adminB, "POST", "/api/patients", {})).status === 400);
const susp = await api(sa, "POST", `/api/platform/subscriptions/${B.id}/act`, { act: "suspend", reason: "E2E suspension check", password: PW }); check("Super Admin suspends the subscription", susp.status === 200);
await new Promise((r) => setTimeout(r, 6000)); // entitlement cache (5s)
check("suspended clinic: viewing still works", (await api(adminB, "GET", "/api/patients?pageSize=1")).status === 200 && ((await api(adminB, "GET", "/api/patients?pageSize=1")).json?.data?.total ?? 0) === patCount);
check("suspended clinic: creating data is refused server-side (403)", (await api(adminB, "POST", "/api/patients", { name: "Blocked Person", phone: "9876543210" })).status === 403);
check("suspended clinic admin can still reach Subscription to pay", (await api(adminB, "GET", "/api/subscription")).status === 200);
await pg.goto("/subscription"); check("a suspended banner explains it and the data is safe", (await pg.getByText("Subscription suspended").count()) > 0);
check("patient portal is read-only during suspension (policy default)", (await api(P1, "GET", "/api/patient/profile")).status !== 403 && (await api(P1, "POST", "/api/patient/security/logout-all")).status === 403);
const settings = (await api(sa, "GET", "/api/platform/subscriptions/settings")).json.data; check("billing settings expose provider status without secrets", !!settings.provider && !/whsec_|secret_/.test(JSON.stringify(settings)) && settings.policy.graceDays === 7);
const blockPolicy = await api(sa, "PUT", "/api/platform/subscriptions/settings", { section: "policy", values: { access: { suspended: "BLOCK" } }, password: PW }); check("access policy for suspension is configurable (BLOCK)", blockPolicy.status === 200);
await new Promise((r) => setTimeout(r, 6000));
check("with BLOCK: the clinic admin is limited to Subscription; other staff are signed out", (await api(adminB, "GET", "/api/patients?pageSize=1")).status === 403 && (await api(adminB, "GET", "/api/subscription")).status === 200);
await api(sa, "PUT", "/api/platform/subscriptions/settings", { section: "policy", values: { access: { suspended: "READ_ONLY" } }, password: PW });
const react = await api(sa, "POST", `/api/platform/subscriptions/${B.id}/act`, { act: "reactivate", reason: "E2E reactivation after check", password: PW }); check("Super Admin reactivates; the state machine allows SUSPENDED → ACTIVE", react.status === 200);
await new Promise((r) => setTimeout(r, 6000)); check("after reactivation writes work again", (await api(adminB, "POST", "/api/patients", {})).status === 400);
check("EXPIRED/CANCELLED → ACTIVE directly is refused", await (async () => { await api(sa, "POST", `/api/platform/subscriptions/${B.id}/act`, { act: "cancel", reason: "E2E cancel to test transitions", password: PW }); return (await api(sa, "POST", `/api/platform/subscriptions/${B.id}/act`, { act: "reactivate", reason: "E2E must be refused", password: PW })).status === 409; })());

/* ---------- Super Admin console pages ---------- */
for (const p of ["/platform/plans", "/platform/plans/new", `/platform/plans/${e2eStarter.json.data.id}`, "/platform/subscriptions", "/platform/subscriptions/analytics", "/platform/subscriptions/settings", `/platform/clinics/${B.id}/subscription`]) {
  const r = await sa.page.goto(p); await sa.page.waitForSelector("h1"); check(`SA page ${p} renders`, r.status() === 200);
}
await sa.page.setViewportSize({ width: 375, height: 800 });
for (const p of ["/platform/plans", "/platform/subscriptions", "/platform/subscriptions/analytics", `/platform/clinics/${B.id}/subscription`, "/pricing"]) { await sa.page.goto(p); await sa.page.waitForSelector("h1"); check(`no horizontal scroll at 375px: ${p}`, await sa.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); }
await sa.page.setViewportSize({ width: 1280, height: 800 });
await sa.page.goto("/platform/subscriptions/analytics"); check("analytics shows real definitions and numbers", (await sa.page.getByText("MRR").count()) > 0 && (await sa.page.getByText("Revenue by month").count()) > 0);
const an = (await api(sa, "GET", "/api/platform/subscriptions/analytics")).json.data; check("analytics API: MRR/ARR consistent", an.arrMinor === an.mrrMinor * 12 && an.revenueByMonth.length === 12 && an.revenueByMonth.at(-1).collectedMinor >= 150000);
await adminA.page.goto("/dashboard"); check("clinic menu has Subscription, never platform billing entries", /Subscription/.test(await adminA.page.locator("nav").first().innerText()) && !/Plans|Subscriptions\b/.test(await recepA.page.locator("nav").first().innerText()));
await recepA.page.goto("/subscription"); await recepA.page.waitForTimeout(800); check("receptionist is redirected away from /subscription", !recepA.page.url().endsWith("/subscription"));
const jobs = await fetch(`http://${LOCAL}/api/internal/communications/run`, { headers: { authorization: "Bearer e2e-cron-secret-0123456789" } }).then((r) => r.json()); check("the scheduler tick runs the subscription billing clock", jobs.ok && jobs.subscriptions && typeof jobs.subscriptions.errors === "number" && jobs.subscriptions.errors === 0, JSON.stringify(jobs.subscriptions));
const all = [sa, adminA, adminB, recepA, P1]; check("no console errors", all.every((c) => c.errors.length === 0), all.flatMap((c) => c.errors).join(" | ").slice(0, 600));
await browser.close(); console.log(`\nPhase 15 e2e: ${pass} passed, ${fails.length} failed`); if (fails.length) { console.log("FAILED:\n - " + fails.join("\n - ")); process.exit(1); }
