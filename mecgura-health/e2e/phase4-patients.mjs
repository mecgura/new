/**
 * Live HTTP + browser checks for Phase 4 (Patient CRM / digital file / Patient 360).
 * Run against a PRODUCTION build (NEXT_DIST_DIR=.next-prod next start -p 3101), after `npm run db:seed`.
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
  let j = null; try { j = await r.json(); } catch { /* */ }
  return { status: r.status(), json: j };
};

const recepA = await login("reception@demo.mecgura.test"), adminA = await login("admin@demo.mecgura.test"), docA = await login("doctor@demo.mecgura.test");
const recepB = await login("reception@demob.mecgura.test"), docB = await login("doctor@demob.mecgura.test");

/* ---------- API: list, tenant isolation, authz ---------- */
const listA = (await api(recepA, "GET", "/api/patients?q=Demo%20Patient")).json.data;
const listB = (await api(recepB, "GET", "/api/patients?q=Demo%20Patient")).json.data;
check("clinic A list: its 3 demo patients, masked phones", listA.total === 3 && listA.rows.every((r) => r.phoneMasked.startsWith("••••••")) && !JSON.stringify(listA).includes("+91"));
const pA = listA.rows.find((r) => r.name === "Demo Patient One"), pB = listB.rows.find((r) => r.name === "Demo Patient One");
check("each clinic has its own patient ids/codes", !!pA && !!pB && pA.id !== pB.id);
check("A can open A's patient", (await api(recepA, "GET", `/api/patients/${pA.id}`)).status === 200);
check("B cannot open A's patient (API)", (await api(recepB, "GET", `/api/patients/${pA.id}`)).status === 404);
check("A cannot open B's patient (API)", (await api(recepA, "GET", `/api/patients/${pB.id}`)).status === 404);
for (const sub of ["timeline", "visits", "appointments", "family", "records/allergies", "records/notes"]) check(`B cannot read A's ${sub}`, (await api(docB, "GET", `/api/patients/${pA.id}/${sub}`)).status === 404);
check("B cannot edit A's patient", (await api(recepB, "PATCH", `/api/patients/${pA.id}`, { name: "Hacked Person", phone: "9876500001" })).status === 404);
check("B cannot write a record on A's patient", (await api(docB, "POST", `/api/patients/${pA.id}/records/allergies`, { allergen: "Injected" })).status === 404);
check("B cannot archive/export A's patient", (await api(recepB, "POST", `/api/patients/${pA.id}/archive`, {})).status === 403 && (await api(adminA, "POST", `/api/patients/${pB.id}/export`)).status === 404);
check("search never leaks across clinics", (await api(recepB, "GET", `/api/patients/search?q=Walkin`)).json.data.length === 0 && (await api(recepB, "GET", `/api/patients?q=${encodeURIComponent("Demo Patient One")}`)).json.data.rows.every((r) => r.id !== pA.id));
check("no wildcard dump: q='*' matches nothing", (await api(recepA, "GET", "/api/patients?q=*")).json.data.total === 0);
check("page size is capped at 20", (await api(recepA, "GET", "/api/patients?page=1")).json.data.rows.length <= 20);
check("unauthenticated -> 401", (await (await fetch(`http://${LOCAL}/api/patients`)).status) === 401);
check("cross-site POST blocked", (await api(recepA, "POST", "/api/patients", { name: "Evil Person", phone: "9876500002" }, "https://evil.example")).status === 403);
check("client-sent tenantId/status/code ignored", await (async () => { const r = await api(recepA, "POST", "/api/patients", { name: "Sneaky Person", phone: "9876509001", tenantId: "x", status: "ARCHIVED", code: "P-999999" }); const g = await api(recepA, "GET", `/api/patients/${r.json.data.id}`); return r.status === 200 && g.json.data.patient.status === "ACTIVE" && g.json.data.patient.code !== "P-999999"; })());

/* ---------- role / field-level access over HTTP ---------- */
const asRecep = (await api(recepA, "GET", `/api/patients/${pA.id}`)).json.data, asDoc = (await api(docA, "GET", `/api/patients/${pA.id}`)).json.data;
check("reception profile: no clinical access, no allergy alert", asRecep.access.clinical === false && asRecep.alerts === null);
check("doctor profile: clinical + allergy alert", asDoc.access.clinical === true && asDoc.alerts.allergies.length === 1);
check("reception can't read allergies/history/medicines", (await api(recepA, "GET", `/api/patients/${pA.id}/records/allergies`)).status === 403 && (await api(recepA, "GET", `/api/patients/${pA.id}/records/history`)).status === 403 && (await api(recepA, "GET", `/api/patients/${pA.id}/records/medications`)).status === 403);
check("reception can read non-clinical notes only", (await api(recepA, "GET", `/api/patients/${pA.id}/records/notes`)).json.data.items.every((n) => n.kind !== "CLINICAL"));
check("doctor can't edit demographics or archive", (await api(docA, "PATCH", `/api/patients/${pA.id}`, { name: "Demo Patient One", phone: "9000000010" })).status === 403 && (await api(docA, "POST", `/api/patients/${pA.id}/archive`, {})).status === 403);
check("only admin can export", (await api(recepA, "POST", `/api/patients/${pA.id}/export`)).status === 403 && (await api(docA, "POST", `/api/patients/${pA.id}/export`)).status === 403 && (await api(adminA, "POST", `/api/patients/${pA.id}/export`)).status === 200);
check("unknown record kind -> 404", (await api(docA, "GET", `/api/patients/${pA.id}/records/secrets`)).status === 404);
check("doctor writes an allergy, reception can't", (await api(docA, "POST", `/api/patients/${pA.id}/records/allergies`, { allergen: "E2E allergen", severity: "MILD" })).status === 200 && (await api(recepA, "POST", `/api/patients/${pA.id}/records/allergies`, { allergen: "Nope" })).status === 403);

/* ---------- archive / restore over HTTP ---------- */
const tmp = (await api(recepA, "POST", "/api/patients", { name: "Archive Candidate", phone: "9876509002" })).json.data;
check("admin archives, reception can't", (await api(recepA, "POST", `/api/patients/${tmp.id}/archive`, {})).status === 403 && (await api(adminA, "POST", `/api/patients/${tmp.id}/archive`, { reason: "e2e" })).status === 200);
check("archived patient leaves the active list but stays on the archived list", (await api(recepA, "GET", "/api/patients?q=Archive%20Candidate")).json.data.total === 0 && (await api(recepA, "GET", "/api/patients?q=Archive%20Candidate&status=ARCHIVED")).json.data.total === 1);
check("archived patient is read-only", (await api(recepA, "PATCH", `/api/patients/${tmp.id}`, { name: "Archive Candidate", phone: "9876509002" })).status === 409);
check("admin restores", (await api(adminA, "POST", `/api/patients/${tmp.id}/restore`)).status === 200 && (await api(recepA, "GET", "/api/patients?q=Archive%20Candidate")).json.data.total === 1);

/* ---------- UI: list, register with duplicate check, profile ---------- */
{
  const { page, errors } = recepA;
  await page.goto(`http://${LOCAL}/patients`, { waitUntil: "networkidle" });
  check("patients list renders", await page.getByRole("heading", { name: "Patients", level: 1 }).isVisible() && await page.getByRole("link", { name: "Register patient" }).isVisible());
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("Demo Patient One"); await page.getByRole("button", { name: "Apply" }).click(); await page.waitForURL(/q=Demo/);
  check("search filters the list", (await page.getByRole("link", { name: "Demo Patient One" }).count()) >= 1 && (await page.getByRole("link", { name: "Demo Patient Two" }).count()) === 0);

  await page.goto(`http://${LOCAL}/patients/new`, { waitUntil: "networkidle" });
  await page.getByLabel("Full name").fill("Demo Patient One"); await page.getByLabel(/^Mobile number/).fill("9000000010");
  await page.getByRole("button", { name: "Register patient" }).click();
  await page.getByText("Possible existing patient found").waitFor({ timeout: 10000 });
  check("duplicate panel shows masked match + choices", await page.getByRole("button", { name: "Use existing patient" }).first().isVisible() && await page.getByRole("button", { name: "Continue new registration" }).isVisible() && !(await page.locator("body").innerText()).includes("9000000010"));
  await page.getByRole("button", { name: "Cancel" }).first().click();
  await page.getByLabel("Full name").fill("UI Registered Person"); await page.getByLabel(/^Mobile number/).fill("9876509100");
  await page.getByLabel("Date of birth").fill("1991-06-15"); await page.getByLabel(/shown the clinic's privacy notice/).check();
  await page.getByRole("button", { name: "Register patient" }).click();
  await page.waitForURL(/\/patients\/c[a-z0-9]+$/, { timeout: 15000 });
  check("registration lands on the new patient's file", await page.getByRole("heading", { level: 1, name: /UI Registered Person/ }).isVisible() && /P-\d{6}/.test(await page.locator("body").innerText()));

  await page.goto(`http://${LOCAL}/patients/${pA.id}`, { waitUntil: "networkidle" });
  check("reception sees header, summary and sections", await page.getByRole("heading", { level: 1, name: /Demo Patient One/ }).isVisible() && await page.getByRole("tab", { name: "Timeline" }).isVisible() && await page.getByRole("tab", { name: "Notes" }).isVisible());
  check("reception does NOT see clinical sections", (await page.getByRole("tab", { name: "Allergies" }).count()) === 0 && (await page.getByRole("tab", { name: "Medications" }).count()) === 0 && (await page.getByText("ALLERGY", { exact: true }).count()) === 0);
  await page.getByRole("tab", { name: "Timeline" }).click(); await page.getByText("Patient registered").waitFor({ timeout: 10000 });
  check("timeline shows real events and billing filter is now enabled (Phase 8)", await page.getByRole("button", { name: /Billing/ }).isEnabled());
  await page.getByRole("tab", { name: "Visits" }).click(); await page.getByText(/Visits \(OPD\)/).waitFor();
  await page.getByRole("tab", { name: "Billing" }).click();
  check("billing tab is live (Phase 8), not a placeholder", (await page.getByText("Coming in a later phase").count()) === 0);
  await page.getByRole("tab", { name: "Family" }).click(); await page.getByText(/Demo Patient Two/).first().waitFor({ timeout: 10000 });
  await page.getByRole("tab", { name: "Notes" }).click(); await page.getByRole("button", { name: "Add note" }).click();
  await page.getByRole("dialog").getByLabel("Note").fill("E2E reception note"); await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.getByText("E2E reception note").waitFor({ timeout: 10000 });
  check("note added through the UI", true);
  await page.getByRole("button", { name: "More actions" }).click();
  check("reception More menu has no archive/export", (await page.getByRole("menuitem", { name: /Archive|Export/ }).count()) === 0);
  await page.keyboard.press("Escape");
  check("reception UI: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page, errors } = docA;
  await page.goto(`http://${LOCAL}/patients/${pA.id}`, { waitUntil: "networkidle" });
  check("doctor sees the allergy alert banner (icon + text)", await page.getByRole("alert").filter({ hasText: "ALLERGY" }).isVisible());
  await page.getByRole("tab", { name: "Allergies" }).click(); await page.getByText("E2E allergen").waitFor({ timeout: 10000 });
  await page.getByRole("tab", { name: "Medical information" }).click(); await page.getByText("Medical history").first().waitFor();
  await page.getByRole("tab", { name: "Medications" }).click(); await page.getByText(/Demo medicine/).waitFor();
  check("doctor sees medicines summary as a record, not a prescription", await page.getByText(/not a prescription/).isVisible());
  check("doctor has no Edit/Archive for demographics", (await page.getByRole("link", { name: "Edit" }).count()) === 0 && (await page.getByRole("button", { name: "More actions" }).count()) === 0);
  check("doctor UI: no console errors", errors.length === 0, errors.join(" | "));
}
{
  const { page, errors } = adminA;
  await page.goto(`http://${LOCAL}/patients/${pA.id}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "More actions" }).click();
  check("admin More menu has export + archive", await page.getByRole("menuitem", { name: "Archive patient" }).isVisible() && await page.getByRole("menuitem", { name: "Export patient data" }).isVisible());
  await page.keyboard.press("Escape");
  await page.goto(`http://${LOCAL}/patients/${pB.id}`);
  check("direct URL to the other clinic's patient -> 404 page", (await page.locator("body").innerText()).includes("not found") || (await page.title()).toLowerCase().includes("not found") || (await page.locator("body").innerText()).toLowerCase().includes("404"));
  const resp = await page.request.get(`http://${LOCAL}/patients/${pB.id}`, { failOnStatusCode: false });
  const html = await resp.text();
  check("direct URL renders the not-found page with no patient data", /not found/i.test(html) && !html.includes("Demo Patient One") && !html.includes("Sample Road"));
  check("admin UI: no console errors", errors.filter((e) => !/404/.test(e)).length === 0, errors.join(" | "));
}
{
  const html = await (await docB.ctx.request.get(`http://${LOCAL}/patients/${pA.id}`, { failOnStatusCode: false })).text();
  check("clinic B doctor can't load A's patient page (not-found, no data)", /not found/i.test(html) && !html.includes("E2E allergen") && !html.includes("Demo Patient Two"));
}

/* ---------- Phase 3 connections ---------- */
{
  const { page } = recepA;
  await page.goto(`http://${LOCAL}/opd`, { waitUntil: "networkidle" });
  check("OPD board links names to patient files", (await page.locator('a[href^="/patients/"]').count()) >= 1);
}

/* ---------- responsive / a11y sweep ---------- */
const pages = [[recepA, `/patients`], [recepA, `/patients/new`], [recepA, `/patients/${pA.id}`], [recepA, `/patients/${pA.id}/edit`], [docA, `/patients/${pA.id}`]];
for (const width of [320, 375, 390, 430, 768, 1280, 1920]) {
  for (const [acct, path] of pages) {
    const page = await acct.ctx.newPage(); await page.setViewportSize({ width, height: 900 });
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`http://${LOCAL}${path}`, { waitUntil: "networkidle" });
    const label = `${path.replace(pA.id, ":id").slice(0, 26)} @${width}`;
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const unnamed = await page.evaluate(() => [...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea")].filter((e) => { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden" || e.closest("dialog:not([open])")) return false; return !(e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || e.textContent?.trim() || e.labels?.length || e.getAttribute("title") || e.getAttribute("placeholder")); }).length);
    const h1 = await page.locator("h1").count();
    check(`${label}: no horizontal overflow`, over <= 1, `${over}px`);
    check(`${label}: one h1, controls named, no js errors`, h1 === 1 && unnamed === 0 && errs.length === 0, `h1=${h1} unnamed=${unnamed} ${errs.join("|")}`);
    if (path.endsWith(pA.id) && acct === docA) {
      for (const t of ["Timeline", "Allergies", "Medical information"]) { await page.getByRole("tab", { name: t }).click(); await page.waitForTimeout(400); }
      const o2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${label}: tabs (timeline/allergies/medical) no overflow`, o2 <= 1, `${o2}px`);
    }
    await page.close();
  }
}

console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) console.log(fails.map((f) => " - " + f).join("\n"));
await browser.close();
process.exit(fails.length ? 1 : 0);
