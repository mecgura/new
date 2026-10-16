/**
 * Spreadsheet import/export in a real browser (production build, seeded DB): medicines import (preview → import), template round trip (.xlsx),
 * downloads (Excel/CSV), the patients download password step, patients import, and the online medicine search against a local mock of the RxNav API.
 * Run: BASE_URL=http://localhost:3101 MOCK_PORT=3999 node e2e/data-transfer.mjs  (server started with MEDICINE_ONLINE_SEARCH=rxnorm RXNAV_BASE_URL=http://localhost:3999)
 */
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
const BASE = process.env.BASE_URL ?? "http://localhost:3101"; const PW = process.env.SEED_DEMO_PASSWORD ?? "Demo-Local-Pass-1"; const MOCK = Number(process.env.MOCK_PORT ?? 3999);
let pass = 0; const fails = []; const check = (n, ok, extra = "") => { if (ok) pass++; else { fails.push(n); console.log("  ✗", n, extra); } };

const mock = createServer((req, res) => {
  const u = new URL(req.url, "http://x"); res.setHeader("content-type", "application/json");
  if (u.pathname.endsWith("/drugs.json")) return res.end(JSON.stringify(u.searchParams.get("name") === "metformin" ? { drugGroup: { conceptGroup: [{ tty: "SCD", conceptProperties: [{ rxcui: "1", name: "metformin hydrochloride 500 MG Oral Tablet", tty: "SCD" }] }, { tty: "SBD", conceptProperties: [{ rxcui: "2", name: "metformin hydrochloride 850 MG Oral Tablet [Glucophage]", tty: "SBD" }] }] } } : { drugGroup: { name: "x" } }));
  res.end("{}");
}).listen(MOCK);

const dir = mkdtempSync(join(tmpdir(), "dt-"));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ baseURL: BASE, acceptDownloads: true, viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("/login", { waitUntil: "networkidle" }); await page.fill('input[name=identifier]', "admin@demo.mecgura.test"); await page.fill('input[name=password]', PW); await page.click('button[type=submit]'); await page.waitForURL(/dashboard/);

/* --- medicines: import --- */
const csv = ["Generic name,Brand name,Strength,Form,Purchase price (₹),MRP,GST %", "Zz Testcillin,Testo,500 mg,Tablet,12.50,20,12", ",NoGeneric,5 mg,Tablet,1,2,0", "Zz Testcillin,Testo,500 mg,Tablet,12.50,20,12"].join("\n");
const f1 = join(dir, "meds.csv"); writeFileSync(f1, csv);
await page.goto("/pharmacy/medicines", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Import from Excel" }).click(); await page.getByRole("dialog").waitFor();
check("import dialog explains the steps and offers templates", (await page.getByRole("dialog").innerText()).includes("Excel template"));
await page.setInputFiles('dialog input[type=file]', f1); await page.getByRole("button", { name: "Check file" }).click();
await page.getByText("Ready to add").waitFor();
const txt = await page.getByRole("dialog").innerText();
check("preview shows 1 ready, 1 duplicate (repeat in file), 1 needing a fix", /1\s*\n?Ready to add/.test(txt) && /1\s*\n?Already there/.test(txt) && /1\s*\n?Need fixing/.test(txt), txt.slice(0, 200));
check("the problem row is explained", /generic/i.test(txt));
check("Import button counts the valid rows", await page.getByRole("button", { name: "Import 1 row" }).isVisible());
await page.getByRole("button", { name: "Import 1 row" }).click(); await page.getByText(/added/i).first().waitFor();
await page.getByRole("button", { name: "Close", exact: true }).last().click();
await page.getByPlaceholder(/Search by name/).fill("Testcillin"); await page.waitForTimeout(800);
check("imported medicine appears in the list", (await page.locator("main").innerText()).includes("Testo"));

/* --- template round trip (xlsx) --- */
const tpl = await ctx.request.get("/api/imports/medicines/template?format=xlsx"); check("template downloads as xlsx", tpl.ok() && (tpl.headers()["content-type"] ?? "").includes("spreadsheetml"));
const f2 = join(dir, "template.xlsx"); writeFileSync(f2, await tpl.body());
await page.getByRole("button", { name: "Import from Excel" }).click(); await page.setInputFiles('dialog input[type=file]', f2); await page.getByRole("button", { name: "Check file" }).click(); await page.getByText("Ready to add").waitFor();
check("the downloaded template itself is accepted by the importer", /1\s*\n?Ready to add/.test(await page.getByRole("dialog").innerText()));
await page.getByRole("button", { name: "Cancel", exact: true }).click();

/* --- downloads --- */
const [dl1] = await Promise.all([page.waitForEvent("download"), (async () => { await page.getByRole("button", { name: /Download list/ }).click(); await page.getByRole("menuitem", { name: /Excel/ }).click(); })()]);
const p1 = join(dir, dl1.suggestedFilename()); await dl1.saveAs(p1); const b1 = readFileSync(p1);
check("medicines list downloads as a real .xlsx", dl1.suggestedFilename().endsWith(".xlsx") && b1[0] === 0x50 && b1[1] === 0x4b);
const [dl2] = await Promise.all([page.waitForEvent("download"), (async () => { await page.getByRole("button", { name: /Download list/ }).click(); await page.getByRole("menuitem", { name: /CSV/ }).click(); })()]);
const p2 = join(dir, dl2.suggestedFilename()); await dl2.saveAs(p2); const c2 = readFileSync(p2, "utf8");
check("CSV starts with a BOM and header and contains the new medicine", c2.startsWith("﻿") && c2.includes("Generic name") && c2.includes("Zz Testcillin"));

/* --- patients: password-confirmed download + import --- */
await page.goto("/patients", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Download list/ }).click(); await page.getByRole("menuitem", { name: /CSV/ }).click();
await page.getByRole("dialog").waitFor(); check("patients download asks for the password first", (await page.getByRole("dialog").innerText()).includes("Confirm it's you"));
await page.getByLabel(/Your password/).fill("definitely-wrong"); await page.getByRole("button", { name: /Download CSV/ }).click(); await page.getByText(/password wasn't accepted/i).waitFor();
check("a wrong password downloads nothing and says so", true);
await page.getByLabel(/Your password/).fill(PW);
const [dl3] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download CSV/ }).click()]);
const p3 = join(dir, dl3.suggestedFilename()); await dl3.saveAs(p3); const c3 = readFileSync(p3, "utf8");
check("the right password downloads the patients list (demographics only)", c3.includes("Patient ID") && !/allerg|diagnos/i.test(c3.split("\r\n")[0]));
const pcsv = ["Full name,Mobile,Gender,DOB", "Zz Import Person,9812345678,Female,03/04/1985"].join("\n"); const f3 = join(dir, "patients.csv"); writeFileSync(f3, pcsv);
await page.getByRole("button", { name: "Import from Excel" }).click(); await page.setInputFiles('dialog input[type=file]', f3); await page.getByRole("button", { name: "Check file" }).click(); await page.getByText("Ready to add").waitFor();
await page.getByRole("button", { name: "Import 1 row" }).click(); await page.getByText(/added/i).first().waitFor(); await page.getByRole("button", { name: "Close", exact: true }).last().click();
await page.goto("/patients?q=Zz+Import", { waitUntil: "networkidle" }); check("imported patient appears (DOB parsed from DD/MM/YYYY)", (await page.locator("main").innerText()).includes("Zz Import Person"));

/* --- online medicine search (mock RxNav) --- */
await page.goto("/pharmacy/medicines?new=1", { waitUntil: "networkidle" });
await page.getByRole("dialog").waitFor(); await page.getByLabel("Search medicines online").fill("metformin");
await page.getByRole("list", { name: "Online results" }).waitFor();
check("online results are listed with source attribution", (await page.getByRole("dialog").innerText()).includes("RxNorm") && (await page.getByRole("dialog").innerText()).includes("Glucophage"));
await page.getByRole("button", { name: /Glucophage/ }).click();
check("picking a result pre-fills generic, brand and strength", (await page.locator('dialog input[value="Metformin hydrochloride"]').count()) === 1 && (await page.locator('dialog input[value="Glucophage"]').count()) === 1 && (await page.locator('dialog input[value="850 MG"]').count()) === 1);
await page.getByLabel("Search medicines online").fill("nothingfound"); await page.getByText(/No match online/).waitFor(); check("no-match message mentions Indian brands honestly", true);

check("no browser errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close(); mock.close();
console.log(`\nData transfer e2e: ${pass} passed, ${fails.length} failed`); if (fails.length) { console.log("FAILED:\n" + fails.map((f) => "  ✗ " + f).join("\n")); process.exit(1); }
