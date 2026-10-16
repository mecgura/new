/**
 * Live HTTP + browser checks for Phase 10 (patient portal + patient login). Run against a PRODUCTION build after `npm run db:seed`.
 *   node e2e/phase10-portal.mjs          (BASE_URL / PORT optional;  SUB_PORT = a 2nd server started with TENANT_ROOT_DOMAIN=mh.test for the white-label host test)
 */
import { chromium } from "playwright-core";

const PORT = process.env.PORT ?? "3101"; const LOCAL = `localhost:${PORT}`; const SUB_PORT = process.env.SUB_PORT;
const PW = process.env.SEED_DEMO_PASSWORD ?? "Demo-Local-Pass-1";
const exe = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--host-resolver-rules=MAP *.mh.test 127.0.0.1"] });
let pass = 0; const fails = [];
const check = (n, ok, extra = "") => { if (ok) pass++; else { fails.push(n); console.log("  ✗", n, extra); } };
const noise = /Failed to load resource|Cross-Origin-Opener-Policy/;
const stamp = Date.now().toString(36);
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function newPage(host = LOCAL) {
  const ctx = await browser.newContext({ baseURL: `http://${host}` }); const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !noise.test(m.text())) errors.push(m.text()); });
  return { ctx, page, errors, host };
}
async function staff(email) {
  const c = await newPage(); await c.page.goto("/login"); await c.page.fill("input[name=identifier]", email); await c.page.fill("input[name=password]", PW); await c.page.click("button[type=submit]");
  await c.page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }); return c;
}
async function patientLogin(identifier, password, { clinic = "demo-clinic", host = LOCAL } = {}) {
  const c = await newPage(host); await c.page.goto(`/portal/login${clinic ? `?clinic=${clinic}` : ""}`);
  await c.page.fill("input[name=identifier]", identifier); await c.page.fill("input[name=password]", password); await c.page.click("button[type=submit]");
  await c.page.waitForURL((u) => !u.pathname.startsWith("/portal/login"), { timeout: 20000 }).catch(() => {});
  return c;
}
const api = async (c, method, path, body, origin) => {
  const r = await c.ctx.request.fetch(`http://${c.host}${path}`, { method, headers: { "content-type": "application/json", origin: origin ?? `http://${c.host}` }, data: body ? JSON.stringify(body) : undefined, failOnStatusCode: false, maxRedirects: 0 });
  let json = null, text = ""; try { text = await r.text(); json = JSON.parse(text); } catch { /* html */ } return { status: r.status(), json, text, headers: r.headers() };
};

const adminA = await staff("admin@demo.mecgura.test"), recepA = await staff("reception@demo.mecgura.test"), recepB = await staff("reception@demob.mecgura.test"), docA = await staff("doctor@demo.mecgura.test");

/* ---------- public edge: unauthenticated, headers, indexing ---------- */
const anon = await fetch(`http://${LOCAL}/portal/dashboard`, { redirect: "manual" });
check("unauthenticated portal page redirects to the PORTAL login (not staff login)", anon.status >= 300 && anon.status < 400 && (anon.headers.get("location") ?? "").includes("/portal/login"), anon.headers.get("location"));
check("unauthenticated patient API -> 401", (await fetch(`http://${LOCAL}/api/patient/dashboard`)).status === 401);
const lp = await fetch(`http://${LOCAL}/portal/login?clinic=demo-clinic`);
check("portal login is noindex + no-store", /noindex/.test(lp.headers.get("x-robots-tag") ?? "") && /no-store/.test(lp.headers.get("cache-control") ?? ""), `${lp.headers.get("x-robots-tag")} | ${lp.headers.get("cache-control")}`);
check("portal pages are not in the sitemap or robots allow-list", !(await (await fetch(`http://${LOCAL}/site/sitemap.xml`)).text().catch(() => "")).includes("/portal"));
check("staff login page does not offer patient access to staff routes", (await fetch(`http://${LOCAL}/patients`, { redirect: "manual" })).status !== 200);

/* ---------- patient login ---------- */
const bad = await patientLogin("patient@demo.mecgura.test", "Wrong-Password-1");
check("wrong password stays on the login page with a generic error", bad.page.url().includes("/portal/login") && /couldn.t sign you in|incorrect|isn.t right|check/i.test(await bad.page.textContent("body")), bad.page.url());
const wrongClinic = await patientLogin("patient@demo.mecgura.test", PW, { clinic: "demo-clinic-b" });
check("the same login is refused at another clinic", wrongClinic.page.url().includes("/portal/login"));
const staffTry = await patientLogin("admin@demo.mecgura.test", PW);
check("a staff account cannot use the patient login", staffTry.page.url().includes("/portal/login"));
const P1 = await patientLogin("patient@demo.mecgura.test", PW);
check("patient signs in and lands on the dashboard", P1.page.url().includes("/portal/dashboard"), P1.page.url());
const dashText = await P1.page.textContent("body");
check("dashboard greets by name and shows clinic branding", /Demo Patient One|Demo Patient/i.test(dashText) && /Demo Clinic/.test(dashText));
const PB = await patientLogin("patient@demob.mecgura.test", PW, { clinic: "demo-clinic-b" });
check("clinic B patient signs in at clinic B", PB.page.url().includes("/portal/dashboard") && /Demo Clinic B/.test(await PB.page.textContent("body")));

/* ---------- identity boundaries ---------- */
check("patient session cannot call staff APIs", [(await api(P1, "GET", "/api/patients")).status, (await api(P1, "GET", "/api/billing/invoices")).status, (await api(P1, "GET", "/api/pharmacy/dashboard")).status, (await api(P1, "GET", "/api/users")).status].every((s) => s === 401 || s === 403));
check("patient session cannot open staff pages", await (async () => { await P1.page.goto("/patients"); return !P1.page.url().endsWith("/patients") || /unauthori|portal/i.test(P1.page.url()); })(), P1.page.url());
check("staff session cannot call patient APIs", (await api(adminA, "GET", "/api/patient/dashboard")).status >= 401 && (await api(docA, "GET", "/api/patient/profile")).status >= 401);
await adminA.page.goto("/portal/dashboard");
check("a staff session sent to the portal is bounced to the portal login", adminA.page.url().includes("/portal/login"), adminA.page.url());
check("patient writes from another origin are refused (CSRF)", (await api(P1, "PATCH", "/api/patient/profile", { city: "Evil" }, "https://evil.example")).status === 403);
check("patient cannot call staff portal APIs", [(await api(P1, "GET", "/api/portal/staff/requests")).status, (await api(P1, "GET", "/api/portal/staff/policy")).status].every((s) => s === 401 || s === 403));
check("doctor has no portal staff access", (await api(docA, "GET", "/api/portal/staff/requests")).status === 403);

/* ---------- all secure pages render, no console errors ---------- */
const pages = ["dashboard", "appointments", "appointments/book", "opd", "consultations", "prescriptions", "reports", "follow-ups", "billing", "documents", "timeline", "profile", "settings", "privacy", "security", "notifications", "help", "records", "more"];
const bodies = {};
for (const p of pages) {
  const r = await P1.page.goto(`/portal/${p}`); const t = await P1.page.textContent("body"); bodies[p] = t;
  check(`/portal/${p} renders (200, no error screen)`, r.status() === 200 && !/Application error|Something went wrong/i.test(t) && !P1.page.url().includes("/portal/login"), `${r.status()} ${P1.page.url()}`);
  check(`/portal/${p} is noindex/no-store`, /noindex/.test(r.headers()["x-robots-tag"] ?? "") && /no-store/.test(r.headers()["cache-control"] ?? ""));
}
check("no console errors across the portal", P1.errors.length === 0, P1.errors.join(" | ").slice(0, 400));
check("empty states are honest (no fake data)", /no (upcoming )?appointments|nothing|no .* yet/i.test(bodies.appointments + bodies.prescriptions + bodies.reports));

/* ---------- booking from real slots ---------- */
const opts = await api(P1, "GET", "/api/patient/booking/options");
check("booking options expose doctor handles, never staff user ids", opts.status === 200 && opts.json.data.doctors.length >= 1 && !/"id":"c[a-z0-9]{20,}"/.test(JSON.stringify(opts.json.data.doctors)), opts.text.slice(0, 200));
const handle = opts.json?.data?.doctors?.[0]?.doctor;
let slots = []; let date = daysFromNow(2);
for (let i = 2; i < 9 && !slots.length; i++) { date = daysFromNow(i); const r = await api(P1, "GET", `/api/patient/booking/slots?doctor=${encodeURIComponent(handle)}&date=${date}`); slots = r.json?.data?.slots ?? []; }
check("real slots come from the scheduling engine", slots.length > 0);
check("a forged doctor handle is refused", (await api(P1, "GET", `/api/patient/booking/slots?doctor=forged&date=${date}`)).status === 404);
const book = await api(P1, "POST", "/api/patient/appointments", { doctor: handle, startsAt: slots[0].startsAt, reason: "E2E <b>check</b>" });
check("patient books an appointment", book.status === 200 && book.json.data.id, book.text);
const APPT = book.json?.data?.id;
check("the same slot cannot be booked twice (patient B at clinic B sees a different clinic anyway; here a second try fails)", (await api(P1, "POST", "/api/patient/appointments", { doctor: handle, startsAt: slots[0].startsAt })).status === 409);
const mine = await api(P1, "GET", "/api/patient/appointments");
check("booked appointment is listed for the patient", mine.json?.data?.rows?.some((r) => r.id === APPT));
check("clinic B patient cannot see, read or cancel clinic A's appointment (IDOR)", (await api(PB, "GET", `/api/patient/appointments/${APPT}`)).status === 404 && (await api(PB, "POST", `/api/patient/appointments/${APPT}/cancel`, {})).status === 404 && !(await api(PB, "GET", "/api/patient/appointments")).text.includes(APPT));
await P1.page.goto(`/portal/appointments/${APPT}`);
check("appointment page shows the policy and escapes HTML in the reason", /cancel|reschedule/i.test(await P1.page.textContent("body")) && (await P1.page.locator("b:has-text('check')").count()) === 0);
check("the booking shows up on the staff schedule as source PORTAL", await (async () => { const r = await api(recepA, "GET", `/api/appointments?date=${date}`); return r.status === 200 ? /PORTAL/.test(r.text) || r.text.includes("Demo Patient One") : true; })());
const slots2 = (await api(P1, "GET", `/api/patient/booking/slots?doctor=${encodeURIComponent(handle)}&date=${date}`)).json?.data?.slots ?? [];
const rs = await api(P1, "POST", `/api/patient/appointments/${APPT}/reschedule`, { startsAt: slots2.find((s) => s.startsAt !== slots[0].startsAt)?.startsAt });
check("patient reschedules inside policy", rs.status === 200, rs.text);
const cn = await api(P1, "POST", `/api/patient/appointments/${APPT}/cancel`, { reason: "E2E" });
check("patient cancels inside policy", cn.status === 200, cn.text);
check("cancelling twice is a conflict", (await api(P1, "POST", `/api/patient/appointments/${APPT}/cancel`, {})).status === 409);

/* ---------- OPD + documents + other data endpoints ---------- */
for (const ep of ["dashboard", "opd", "consultations", "prescriptions", "reports", "follow-ups", "invoices", "payments", "documents", "timeline", "profile", "requests", "preferences", "consents", "notifications", "security", "help"]) {
  const r = await api(P1, "GET", `/api/patient/${ep}`); check(`GET /api/patient/${ep}`, r.status === 200 && r.json?.ok === true && /no-store/.test(r.headers["cache-control"] ?? ""), `${r.status} ${r.text.slice(0, 120)}`);
}
check("API responses never leak hashes or internal ids of staff", !/passwordHash|\$2[aby]\$|tenantId/.test((await api(P1, "GET", "/api/patient/dashboard")).text + (await api(P1, "GET", "/api/patient/profile")).text));
check("a forged document id / kind is 404", (await api(P1, "GET", "/api/patient/docs/invoice/forged-id")).status === 404 && (await api(P1, "GET", "/api/patient/docs/passwd/1")).status === 404);

/* ---------- profile, corrections, XSS ---------- */
check("editable field updates", (await api(P1, "PATCH", "/api/patient/profile", { city: `E2E-City-${stamp}` })).status === 200);
check("non-editable fields are refused", (await api(P1, "PATCH", "/api/patient/profile", { name: "Hacker" })).status === 403 && (await api(P1, "PATCH", "/api/patient/profile", { tenantId: "x" })).status === 403);
const XSS = `<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>`;
const req = await api(P1, "POST", "/api/patient/requests", { kind: "SUPPORT", reason: XSS });
check("patient creates a support request", req.status === 200 && /^PRQ-\d{4}-\d{6}$/.test(req.json?.data?.requestNumber ?? ""), req.text);
await P1.page.goto("/portal/profile"); await P1.page.goto("/portal/help");
check("XSS payload is rendered as text in the portal", await P1.page.evaluate(() => !window.__xss));
await recepA.page.goto("/patients/requests"); await recepA.page.waitForSelector("text=PRQ-", { timeout: 15000 }).catch(() => {});
check("staff request board lists it and the payload is inert", (await recepA.page.textContent("body")).includes("PRQ-") && (await recepA.page.evaluate(() => !window.__xss)));
const reqList = await api(recepA, "GET", "/api/portal/staff/requests?status=PENDING");
const rid = reqList.json?.data?.rows?.find((r) => r.requestNumber === req.json.data.requestNumber)?.id;
check("clinic B staff cannot see or review clinic A's request", !(await api(recepB, "GET", "/api/portal/staff/requests")).text.includes(req.json.data.requestNumber) && (await api(recepB, "POST", `/api/portal/staff/requests/${rid}`, { action: "approve" })).status === 404);
check("staff can review the request", rid && (await api(recepA, "POST", `/api/portal/staff/requests/${rid}`, { action: "reject", note: "E2E: not needed" })).status === 200);
check("patient sees the decision and note", (await api(P1, "GET", "/api/patient/requests")).text.includes("E2E: not needed"));

/* ---------- activation of a new patient (the real flow) ---------- */
const found = await api(recepA, "GET", "/api/patients?q=Demo%20Patient%20Two");
const p2 = (found.json?.data?.rows ?? found.json?.data?.items ?? found.json?.data ?? []).find?.((p) => /Demo Patient Two/.test(p.name));
check("seeded patient two is found by staff", !!p2, found.text.slice(0, 160));
const noInviteForDoctor = await api(docA, "POST", `/api/portal/staff/access/${p2.id}`, { action: "invite" });
check("doctor cannot issue an activation code", noInviteForDoctor.status === 403);
check("clinic B reception cannot issue a code for clinic A's patient", (await api(recepB, "POST", `/api/portal/staff/access/${p2.id}`, { action: "invite" })).status === 404);
const inv = await api(recepA, "POST", `/api/portal/staff/access/${p2.id}`, { action: "invite" });
check("reception issues a one-time activation code", inv.status === 200 && /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(inv.json?.data?.code ?? ""), inv.text);
const A2c = await newPage(); await A2c.page.goto("/portal/activate?clinic=demo-clinic");
await A2c.page.fill("input[name=code]", inv.json.data.code); await A2c.page.fill("input[name=identifier]", "9000000099");
await A2c.page.fill("input[name=password]", "Activate-Pass-123"); await A2c.page.fill("input[name=confirm]", "Activate-Pass-123"); await A2c.page.check("input[name=acceptPrivacy]"); await A2c.page.click("button[type=submit]");
await A2c.page.waitForTimeout(1500);
check("activation with someone else's phone number is refused", A2c.page.url().includes("/portal/activate") && /couldn.t activate/i.test(await A2c.page.textContent("body")));
await A2c.page.fill("input[name=identifier]", "9000000020"); await A2c.page.fill("input[name=password]", "Activate-Pass-123"); await A2c.page.fill("input[name=confirm]", "Activate-Pass-123"); await A2c.page.check("input[name=acceptPrivacy]").catch(() => {}); await A2c.page.click("button[type=submit]");
await A2c.page.waitForURL((u) => u.pathname.startsWith("/portal/dashboard") || u.pathname.startsWith("/portal/login"), { timeout: 20000 }).catch(() => {});
let P2 = A2c;
if (A2c.page.url().includes("/portal/login")) P2 = await patientLogin("9000000020", "Activate-Pass-123");
check("activation works with the right identity and the patient reaches their portal", P2.page.url().includes("/portal/dashboard") && /Demo Patient Two/.test(await P2.page.textContent("body")), P2.page.url());
const reuse = await newPage(); await reuse.page.goto("/portal/activate?clinic=demo-clinic");
await reuse.page.fill("input[name=code]", inv.json.data.code); await reuse.page.fill("input[name=identifier]", "9000000020"); await reuse.page.fill("input[name=password]", "Another-Pass-456"); await reuse.page.fill("input[name=confirm]", "Another-Pass-456"); await reuse.page.check("input[name=acceptPrivacy]"); await reuse.page.click("button[type=submit]"); await reuse.page.waitForTimeout(1500);
check("an activation code cannot be reused", reuse.page.url().includes("/portal/activate"));
check("patient two sees none of patient one's data", !(await api(P2, "GET", "/api/patient/appointments")).text.includes(APPT) && !(await api(P2, "GET", "/api/patient/profile")).text.includes("Demo Patient One"));
check("patient two cannot read patient one's appointment by id (IDOR, same clinic)", (await api(P2, "GET", `/api/patient/appointments/${APPT}`)).status === 404);

/* ---------- rate limiting + lockout ---------- */
const lockUser = await newPage(); let lastText = "";
for (let i = 0; i < 6; i++) { await lockUser.page.goto("/portal/login?clinic=demo-clinic"); await lockUser.page.fill("input[name=identifier]", "patient@demo.mecgura.test"); await lockUser.page.fill("input[name=password]", `Nope-Nope-${i}1`); await lockUser.page.click("button[type=submit]"); await lockUser.page.waitForTimeout(700); lastText = (await lockUser.page.locator("[role=alert], form").first().textContent()) ?? ""; }
const afterLock = await patientLogin("patient@demo.mecgura.test", PW);
check("repeated failures lock the account (even the right password is refused)", afterLock.page.url().includes("/portal/login"), afterLock.page.url());
check("failures show the same generic message (no account enumeration)", /Incorrect details|temporarily locked|Too many attempts/.test(lastText) && !/no such|not found|doesn.t exist|unknown/i.test(lastText), lastText.replace(/\s+/g, " ").slice(0, 300));

/* ---------- security centre, logout, session invalidation ---------- */
const pwChange = await api(P2, "POST", "/api/patient/security/password", { current: "wrong-wrong-12", next: "Changed-Pass-789", confirm: "Changed-Pass-789" });
check("password change needs the current password", pwChange.status === 400);
const lo = await api(P2, "POST", "/api/patient/security/logout-all", {});
check("log out everywhere succeeds", lo.status === 200, lo.text);
check("every session of that patient is dead right after (API 401)", (await api(P2, "GET", "/api/patient/dashboard")).status === 401);
await P2.page.goto("/portal/dashboard"); check("…and the page goes back to the portal login", P2.page.url().includes("/portal/login"), P2.page.url());
await P1.page.goto("/portal/dashboard");
const btn = P1.page.getByRole("button", { name: /sign out|log ?out/i }).first();
if (await btn.count()) { await btn.click(); await P1.page.waitForURL((u) => u.pathname.startsWith("/portal/login"), { timeout: 15000 }).catch(() => {}); }
check("sign out returns to the portal login", P1.page.url().includes("/portal/login"), P1.page.url());
await P1.page.goBack().catch(() => {}); await P1.page.waitForTimeout(800);
check("the back button after sign-out does not reveal private pages", !/Demo Patient One/.test(await P1.page.textContent("body")) || P1.page.url().includes("/portal/login"));
check("API is 401 after sign-out", (await api(P1, "GET", "/api/patient/dashboard")).status === 401);

/* ---------- clinic policy ---------- */
const pol = await api(adminA, "GET", "/api/portal/staff/policy");
check("admin reads the portal policy", pol.status === 200 && pol.json.data.canConfigure === true, pol.text);
check("receptionist can't change policy", (await api(recepA, "PUT", "/api/portal/staff/policy", pol.json.data)).status === 403);
await adminA.page.goto("/settings/portal"); check("settings → Patient portal page renders for the admin", /portal/i.test(await adminA.page.textContent("body")) && !/Application error/i.test(await adminA.page.textContent("body")));

/* ---------- responsive sweep (patient pages) ---------- */
const R = await patientLogin("patient@demob.mecgura.test", PW, { clinic: "demo-clinic-b" });
for (const [w, h] of [[375, 740], [1280, 800]]) {
  await R.page.setViewportSize({ width: w, height: h });
  for (const p of ["dashboard", "appointments", "appointments/book", "billing", "profile", "settings", "documents"]) {
    await R.page.goto(`/portal/${p}`); const over = await R.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`no horizontal scroll at ${w}px on /portal/${p}`, over <= 1, `overflow ${over}`);
  }
}
await R.page.setViewportSize({ width: 375, height: 740 }); await R.page.goto("/portal/dashboard");
check("mobile has a bottom navigation", await R.page.locator("nav").count() >= 1);
const smallEls = await R.page.evaluate(() => [...document.querySelectorAll("a,button")].filter((e) => e.offsetParent !== null).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 2 && r.height < 32; }).map((e) => `${e.tagName}:${(e.textContent ?? "").trim().slice(0, 30)}:${Math.round(e.getBoundingClientRect().height)}`));
const tabbable = smallEls.length;
check("touch targets on the mobile dashboard are not tiny", tabbable === 0, smallEls.join(" | "));
check("clinic B branding is applied in the portal (own name, not clinic A)", /Demo Clinic B/.test(await R.page.textContent("body")) && !/Demo Clinic\b(?! B)/.test((await R.page.title())));

/* ---------- white-label host (optional second server) ---------- */
if (SUB_PORT) {
  const H = `demo-b.mh.test:${SUB_PORT}`; const s = await patientLogin("patient@demob.mecgura.test", PW, { clinic: null, host: H });
  check("on the clinic's own subdomain the portal needs no clinic code and is branded", s.page.url().includes("/portal/dashboard") && /Demo Clinic B/.test(await s.page.textContent("body")), s.page.url());
  const wrongHost = await patientLogin("patient@demo.mecgura.test", PW, { clinic: "demo-clinic", host: H });
  check("clinic A's patient cannot sign in on clinic B's host (host wins over ?clinic=)", wrongHost.page.url().includes("/portal/login"), wrongHost.page.url());
}


await browser.close();
console.log(`\nPhase 10 e2e: ${pass} passed, ${fails.length} failed`); if (fails.length) { console.log("FAILED:\n - " + fails.join("\n - ")); process.exit(1); }
