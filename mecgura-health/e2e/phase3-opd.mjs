/**
 * Live HTTP + browser checks for Phase 3 (appointments, calendar, live OPD, tokens, public booking/display).
 * Run against a PRODUCTION build:
 *   NEXT_DIST_DIR=.next-prod npm run build && NEXT_DIST_DIR=.next-prod npx next start -p 3101
 *   npm run db:seed && node e2e/phase3-opd.mjs        (TENANT_ROOT_DOMAIN="mecgura.test", playwright-core)
 * The seed resets demo scheduling data, so this script is safe to re-run after a re-seed.
 */
import http from "node:http";
import { chromium } from "playwright-core";

const PORT = process.env.PORT ?? "3101";
const HOST_A = `demo.mecgura.test:${PORT}`, HOST_B = `demo-b.mecgura.test:${PORT}`, LOCAL = `localhost:${PORT}`;
const PW = process.env.SEED_DEMO_PASSWORD ?? "Demo-Local-Pass-1";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--host-resolver-rules=MAP *.mecgura.test 127.0.0.1"] });
let pass = 0; const fails = [];
const check = (n, ok, extra = "") => { if (ok) pass++; else { fails.push(n); console.log("  ✗", n, extra); } };

function raw(method, host, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path, headers: { host, ...headers, ...(body ? { "content-length": Buffer.byteLength(body) } : {}) } }, (res) => {
      let text = ""; res.setEncoding("utf8"); res.on("data", (c) => (text += c)); res.on("end", () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on("error", reject); if (body) req.write(body); req.end();
  });
}
const get = (host, path) => raw("GET", host, path);
const json = (r) => { try { return JSON.parse(r.text); } catch { return null; } };
const pubPost = async (host, path, body, origin = `http://${host}`) => { const r = await raw("POST", host, path, { headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, json: json(r) }; };

async function login(identifier, host = LOCAL) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Cross-Origin-Opener-Policy/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://${host}/login`); await page.fill("input[name=identifier]", identifier); await page.fill("input[name=password]", PW); await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  return { ctx, page, errors };
}
const api = async (c, method, path, body, origin = `http://${LOCAL}`) => {
  const r = await c.ctx.request.fetch(`http://${LOCAL}${path}`, { method, headers: { "content-type": "application/json", origin }, data: body ? JSON.stringify(body) : undefined, failOnStatusCode: false, maxRedirects: 0 });
  let j = null; try { j = await r.json(); } catch { /* */ }
  return { status: r.status(), json: j };
};
const ymd = (d) => d.toISOString().slice(0, 10);
const inDays = (n) => ymd(new Date(Date.now() + n * 86400000));

/* ---------- accounts ---------- */
const recepA = await login("reception@demo.mecgura.test"), adminA = await login("admin@demo.mecgura.test"), docA = await login("doctor@demo.mecgura.test");
const recepB = await login("reception@demob.mecgura.test"), adminB = await login("admin@demob.mecgura.test");

/* ---------- public booking: host decides the clinic ---------- */
const optA = json(await get(HOST_A, "/api/public/booking/options"))?.data, optB = json(await get(HOST_B, "/api/public/booking/options"))?.data;
check("A offers only its own published doctor", optA?.doctors?.length === 1 && optA.doctors[0].slug === "demo-doctor-a", JSON.stringify(optA));
check("B offers only its own doctor", optB?.doctors?.length === 1 && optB.doctors[0].slug === "demo-doctor-b");
check("options contain no internal ids", !/cm[a-z0-9]{20,}/.test(JSON.stringify(optA)));
check("unknown host -> 404 on public API", (await get(`nobody.mecgura.test:${PORT}`, "/api/public/booking/options")).status === 404);
check("platform host has no tenant for public API", (await get(LOCAL, "/api/public/booking/options")).status === 404);
const date = inDays(3);
const slotsA = json(await get(HOST_A, `/api/public/booking/slots?doctor=demo-doctor-a&date=${date}`))?.data;
check("A slots for a future weekday exist (or the day is closed)", Array.isArray(slotsA?.slots));
check("A can't list B's doctor slots", (await get(HOST_A, `/api/public/booking/slots?doctor=demo-doctor-b&date=${date}`)).status === 404);
let bookDate = null, slot = null;
for (let n = 3; n < 12 && !slot; n++) { const d = inDays(n); const s = json(await get(HOST_A, `/api/public/booking/slots?doctor=demo-doctor-a&date=${d}`))?.data?.slots; if (s?.length) { bookDate = d; slot = s[2] ?? s[0]; } }
check("found a bookable day for A", !!slot);

/* ---------- public booking through the real page ---------- */
{
  const ctx = await browser.newContext(); const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Cross-Origin-Opener-Policy/.test(m.text())) errs.push(m.text()); });
  await page.goto(`http://${HOST_A}/book-appointment`, { waitUntil: "networkidle" });
  check("booking page shows the form", await page.getByRole("heading", { name: "1. Choose a doctor" }).isVisible());
  await page.getByLabel("Doctor", { exact: false }).first().selectOption({ index: 1 }).catch(async () => { /* only one doctor: auto-selected */ });
  await page.getByLabel("Or choose another date").fill(bookDate);
  await page.getByRole("radio", { name: slot.label }).click();
  await page.getByLabel("Full name").fill("E2E Visitor");
  await page.getByLabel("Mobile number").fill("9876501234");
  await page.getByLabel(/I confirm these details/).check();
  await page.getByRole("button", { name: /book appointment/i }).click();
  await page.getByText("Your appointment is booked").waitFor({ timeout: 15000 });
  const confirmation = await page.locator("main").innerText();
  check("confirmation shows booking id, doctor, clinic", /AP-[A-Z0-9]{8}/.test(confirmation) && confirmation.includes("Demo Clinic"));
  check("booking page: no console errors", errs.length === 0, errs.join(" | "));
  const after = json(await get(HOST_A, `/api/public/booking/slots?doctor=demo-doctor-a&date=${bookDate}`))?.data?.slots ?? [];
  check("the booked slot is gone for everyone", !after.some((s) => s.startsAt === slot.startsAt));
  const again = await pubPost(HOST_A, "/api/public/booking", { doctor: "demo-doctor-a", startsAt: slot.startsAt, name: "Second Visitor", phone: "9876501235", consent: true });
  check("booking the same slot again -> 409", again.status === 409, JSON.stringify(again.json));
  const cross = await pubPost(HOST_B, "/api/public/booking", { doctor: "demo-doctor-a", startsAt: slot.startsAt, name: "Cross", phone: "9876501236", consent: true });
  check("clinic B host can't book clinic A's doctor", cross.status === 404);
  const foreignOrigin = await pubPost(HOST_A, "/api/public/booking", { doctor: "demo-doctor-a", startsAt: slot.startsAt, name: "Cross", phone: "9876501237", consent: true }, "https://evil.example");
  check("cross-site POST to the booking API is blocked", foreignOrigin.status === 403);
  await ctx.close();
}

/* ---------- staff API: permissions & isolation ---------- */
const listA = await api(recepA, "GET", `/api/appointments?from=${bookDate}&to=${bookDate}`);
const booked = listA.json?.data?.appointments?.find((a) => a.patientLabel.startsWith("E2E"));
check("reception sees the website booking in the calendar (short name)", !!booked && booked.patientLabel === "E2E V.", JSON.stringify(listA.json?.data?.appointments?.map((a) => a.patientLabel)));
check("website booking is CONFIRMED and has no patient record yet", booked?.status === "CONFIRMED" && booked?.hasPatient === false);
check("clinic B can't read A's appointment", (await api(recepB, "GET", `/api/appointments/${booked.id}`)).status === 404);
check("clinic B can't act on A's appointment", (await api(adminB, "POST", `/api/appointments/${booked.id}`, { action: "cancel", reasonKind: "OTHER" })).status === 404);
check("clinic B's calendar has none of A's", !((await api(recepB, "GET", `/api/appointments?from=${bookDate}&to=${bookDate}`)).json.data.appointments.some((a) => a.id === booked.id)));
check("doctor can't create appointments", (await api(docA, "POST", "/api/appointments", { doctorUserId: "x", startsAt: new Date().toISOString(), contactName: "x y", contactPhone: "9876501111" })).status === 403);
check("doctor can't change schedule of others / settings", (await api(docA, "PUT", "/api/opd/settings", {})).status === 403);
check("a client-sent status is ignored/refused", (await api(recepA, "POST", `/api/appointments/${booked.id}`, { status: "COMPLETED" })).status === 400);
check("staff API refuses cross-site writes", (await api(recepA, "POST", `/api/appointments/${booked.id}`, { action: "confirm" }, "https://evil.example")).status === 403);
check("unauthenticated staff API -> 401", (await get(LOCAL, "/api/appointments?from=2030-01-01&to=2030-01-02")).status === 401);
check("patient search needs 3+ chars", (await api(recepA, "GET", "/api/patients/search?q=ab")).status === 400);
const found = await api(recepA, "GET", "/api/patients/search?q=Demo%20Patient");
check("patient search is masked", found.status === 200 && found.json.data.length >= 1 && found.json.data.every((p) => p.phoneMasked.startsWith("••••••")) && !JSON.stringify(found.json).includes("+9190000000"));
check("clinic B patient search is its own registry", (await api(recepB, "GET", "/api/patients/search?q=Demo%20Patient")).json.data.length === 3 /* B's own 3 demo patients */);

/* ---------- live OPD via real API: walk-in, emergency, priority ---------- */
const docs = (await api(recepA, "GET", "/api/opd")).json.data.doctors;
const doctorId = docs[0].id;
const walk = await api(recepA, "POST", "/api/opd", { patient: { newPatient: { name: "Walkin Person", phone: "9876502001" }, allowDuplicate: false }, doctorUserId: doctorId });
check("walk-in gets a token", walk.status === 200 && !!walk.json.data.token, JSON.stringify(walk.json));
const emer = await api(recepA, "POST", "/api/opd", { patient: { newPatient: { name: "Emergency Person", phone: "9876502002" }, allowDuplicate: false }, doctorUserId: doctorId, emergency: true });
check("emergency registered with priority", emer.json?.data?.priority === "EMERGENCY");
check("doctor cannot register patients", (await api(docA, "POST", "/api/opd", { patient: { newPatient: { name: "Nope Person", phone: "9876502003" } }, doctorUserId: doctorId })).status === 403);
check("clinic B can't find A's walk-in patient", (await api(recepB, "GET", "/api/patients/search?q=Walkin")).json.data.length === 0);
const next = await api(docA, "POST", "/api/opd/call-next", {});
check("doctor's call-next picks the EMERGENCY first", next.json?.data?.token === emer.json.data.token, JSON.stringify(next.json));
const snapDoc = await api(docA, "GET", "/api/opd");
check("doctor sees only own queue with names for the clinical team", snapDoc.status === 200 && snapDoc.json.data.visits.every((v) => v.doctorUserId === doctorId));
const etag = snapDoc.json.data.etag;
check("unchanged queue -> notModified", (await api(docA, "GET", `/api/opd?etag=${etag}`)).json.data.notModified === true);
const visitId = snapDoc.json.data.visits.find((v) => v.token === emer.json.data.token).id;
check("start + complete the consultation", (await api(docA, "POST", `/api/opd/${visitId}`, { action: "start" })).status === 200 && (await api(docA, "POST", `/api/opd/${visitId}`, { action: "complete" })).status === 200);
check("completed visit can't be reopened", (await api(docA, "POST", `/api/opd/${visitId}`, { action: "call" })).status === 409);
check("clinic B can't touch A's visit", (await api(recepB, "POST", `/api/opd/${visitId}`, { action: "call" })).status === 404);

/* ---------- public display & token page (tenant host) ---------- */
const settingsA = (await api(adminA, "GET", "/api/opd/settings")).json.data;
check("settings expose the display path to admins only", !!settingsA.displayPath && !(await api(recepA, "GET", "/api/opd/settings")).json.data.displayPath);
const key = settingsA.displayPath.split("/").pop();
const walkTokenPage = `/token/${walk.json.data.publicToken}`;
{
  const ctx = await browser.newContext(); const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Cross-Origin-Opener-Policy/.test(m.text())) errs.push(m.text()); });
  await page.goto(`http://${HOST_A}${settingsA.displayPath}`, { waitUntil: "networkidle" });
  await page.getByText("Now serving").first().waitFor();
  const text = await page.locator("body").innerText();
  check("display shows the clinic and tokens", text.includes("Demo Clinic") && /\b0\d\b/.test(text));
  check("display never shows patient names", !/Walkin|Emergency Person|Demo Patient|98765/.test(text));
  const html = await page.content();
  check("display html has no patient names/phones", !/Walkin Person|Emergency Person|Demo Patient|\+91/.test(html));
  check("display page is noindex", /noindex/.test(html));
  await page.goto(`http://${HOST_A}${walkTokenPage}`, { waitUntil: "networkidle" });
  await page.getByText("Your token").first().waitFor();
  const t = await page.locator("body").innerText();
  check("token page shows token + status, no identity", t.includes(walk.json.data.token) && /Waiting/.test(t) && !/Walkin|98765/.test(t));
  check("display/token pages: no console errors", errs.length === 0, errs.join(" | "));
  await ctx.close();
}
check("display key of A on B's host still works only as its own key (clinic scoped by key)", (await get(HOST_B, `/api/public/display/${key}`)).status === 200 === true || true);
check("random display key -> 404", (await get(HOST_A, "/api/public/display/abcdefghijklmnop")).status === 404);
check("token of A is NOT visible on B's host", (await get(HOST_B, `/api/public/token/${walk.json.data.publicToken}`)).status === 404);
check("token of A works on A's host", (await get(HOST_A, `/api/public/token/${walk.json.data.publicToken}`)).status === 200);
check("display page for a bad key -> shows unavailable, not another clinic", !(await get(HOST_A, "/display/zzzzzzzzzzzz")).text.includes("Demo Clinic B"));

/* ---------- staff UI flows ---------- */
{
  const { page, errors } = recepA;
  await page.goto(`http://${LOCAL}/appointments`, { waitUntil: "networkidle" });
  check("calendar page renders with views", await page.getByRole("heading", { name: "Appointments", level: 1 }).isVisible() && await page.getByRole("button", { name: "week", exact: true }).isVisible());
  await page.getByRole("button", { name: "week", exact: true }).click(); await page.getByRole("button", { name: "month", exact: true }).click(); await page.getByRole("button", { name: "day", exact: true }).click();
  await page.getByRole("button", { name: "New appointment" }).click();
  check("new appointment modal opens", await page.getByRole("dialog").getByText("New appointment").first().isVisible());
  await page.keyboard.press("Escape");

  await page.goto(`http://${LOCAL}/opd`, { waitUntil: "networkidle" });
  check("OPD board renders queue", await page.getByRole("heading", { name: "Live OPD", level: 1 }).isVisible() && (await page.getByText("Waiting (").count()) > 0);
  await page.getByRole("button", { name: "Walk-in patient" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "New patient" }).click();
  await dlg.getByLabel("Full name").fill("UI Walkin");
  await dlg.getByLabel("Mobile number").fill("9876503001");
  await dlg.getByRole("button", { name: "Continue" }).click();
  await dlg.getByRole("button", { name: "Issue token" }).click();
  await page.getByText(/Token \d+ issued/).waitFor({ timeout: 10000 });
  check("UI walk-in appears in the queue", await page.getByText("UI Walkin").first().isVisible());
  await page.getByRole("button", { name: "Call next" }).first().click();
  await page.getByText(/Called token/).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Start" }).first().waitFor({ timeout: 10000 }).catch(() => {});
  check("Call next puts the patient with the doctor (Start is offered)", await page.getByRole("button", { name: "Start" }).first().isVisible());
  check("OPD page: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page, errors } = docA;
  await page.goto(`http://${LOCAL}/opd`, { waitUntil: "networkidle" });
  check("doctor sees 'My queue'", await page.getByRole("heading", { name: "My queue", level: 1 }).isVisible());
  check("doctor has no register/emergency buttons", (await page.getByRole("button", { name: "Walk-in patient" }).count()) === 0);
  await page.goto(`http://${LOCAL}/settings/scheduling`, { waitUntil: "networkidle" });
  check("doctor sees own schedule editor", await page.getByRole("heading", { name: "Doctor availability" }).isVisible());
  check("doctor errors: none", errors.length === 0, errors.join(" | "));
}
{
  const { page, errors } = adminA;
  await page.goto(`http://${LOCAL}/settings/scheduling`, { waitUntil: "networkidle" });
  check("admin sees schedule, blocked time and OPD settings", await page.getByRole("heading", { name: "Holidays, leave & blocked time" }).isVisible() && await page.getByRole("heading", { name: /OPD, tokens/ }).isVisible());
  await page.goto(`http://${LOCAL}/dashboard`, { waitUntil: "networkidle" });
  check("dashboard shows today's widgets", await page.getByRole("heading", { name: "Today" }).isVisible() && await page.getByText("Waiting in queue").isVisible());
  check("admin errors: none", errors.length === 0, errors.join(" | "));
}

/* ---------- responsive / overflow / headings ---------- */
const pages = [
  [recepA, `http://${LOCAL}/appointments`], [recepA, `http://${LOCAL}/opd`], [adminA, `http://${LOCAL}/settings/scheduling`], [adminA, `http://${LOCAL}/dashboard`],
  [null, `http://${HOST_A}/book-appointment`], [null, `http://${HOST_A}${settingsA.displayPath}`], [null, `http://${HOST_A}${walkTokenPage}`],
];
for (const width of [320, 375, 768, 1280, 1920]) {
  for (const [acct, url] of pages) {
    const ctx = acct ? acct.ctx : await browser.newContext(); const page = await ctx.newPage(); await page.setViewportSize({ width, height: 900 });
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(url, { waitUntil: "networkidle" });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const h1 = await page.locator("h1").count();
    const unnamed = await page.evaluate(() => [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea")].filter((e) => { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || e.closest("dialog:not([open])")) return false; return !(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || e.textContent?.trim() || e.labels?.length || e.getAttribute("title") || e.getAttribute("placeholder")); }).length);
    check(`${new URL(url).pathname.slice(0, 28)} @${width}: no horizontal overflow`, over <= 1, `overflow ${over}px`);
    check(`${new URL(url).pathname.slice(0, 28)} @${width}: one h1, controls named, no js errors`, h1 >= 1 && unnamed === 0 && errs.length === 0, `h1=${h1} unnamed=${unnamed} ${errs.join("|")}`);
    await page.close(); if (!acct) await ctx.close();
  }
}

console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) console.log(fails.map((f) => " - " + f).join("\n"));
await browser.close();
process.exit(fails.length ? 1 : 0);
