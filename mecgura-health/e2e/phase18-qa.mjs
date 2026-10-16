/**
 * Phase 18 QA sweep (production build, seeded DB, server started as for Phase 17):
 *  1. role x page matrix for every seeded role — no 5xx, no browser errors, clinic roles never reach /platform, patients never reach staff pages
 *  2. accessibility (axe-core, WCAG A/AA) on key pages
 *  3. responsive: no horizontal overflow at 375 / 768 / 1280 px
 *  4. unauthenticated access to every page redirects to login
 * Writes a JSON result to QA_OUT (default ./qa-results.json).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
const PORT = process.env.PORT ?? "3101"; const BASE = `http://localhost:${PORT}`; const PW = process.env.SEED_DEMO_PASSWORD ?? "Demo-Local-Pass-1";
const AXE = readFileSync(process.env.AXE_PATH ?? "node_modules/axe-core/axe.min.js", "utf8");
const pages = readFileSync(process.env.PAGES ?? "qa-pages.txt", "utf8").split("\n").filter(Boolean);
let pass = 0; const fails = []; const check = (n, ok, extra = "") => { if (ok) pass++; else { fails.push(n); console.log("  ✗", n, extra); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const noise = /Failed to load resource|Cross-Origin-Opener-Policy/;
const ROLES = [["SUPER_ADMIN", "platform@demo.mecgura.test", "/login"], ["CLINIC_ADMIN", "admin@demo.mecgura.test", "/login"], ["DOCTOR", "doctor@demo.mecgura.test", "/login"], ["RECEPTIONIST", "reception@demo.mecgura.test", "/login"], ["ACCOUNTANT", "accountant@demo.mecgura.test", "/login"], ["PHARMACY_STAFF", "pharmacy@demo.mecgura.test", "/login"], ["PHARMACY_MANAGER", "pharmacymgr@demo.mecgura.test", "/login"], ["LAB_STAFF", "lab@demo.mecgura.test", "/login"]];
const matrix = {}; const axeOut = {}; const resp = {};
async function login(email, path = "/login") { if (path.startsWith("/portal")) { const ctx = await browser.newContext({ baseURL: BASE }); const page = await ctx.newPage(); await page.goto(`${path}?clinic=demo-clinic`); await page.fill("input[name=identifier]", email); await page.fill("input[name=password]", PW); await page.click("button[type=submit]"); await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }); return { ctx, page }; } const ctx = await browser.newContext({ baseURL: BASE }); const page = await ctx.newPage(); await page.goto(path); await page.fill("input[name=identifier]", email); await page.fill("input[name=password]", PW); await page.click("button[type=submit]"); await page.waitForURL((u) => !u.pathname.endsWith("/login"), { timeout: 20000 }); return { ctx, page }; }

/* 4 — anonymous */
{ const ctx = await browser.newContext({ baseURL: BASE }); let bad = 0; for (const p of pages) { const r = await ctx.request.get(p, { maxRedirects: 0, failOnStatusCode: false }); if (!(r.status() === 307 || r.status() === 308) || !/\/login/.test(r.headers().location ?? "")) { bad++; console.log("   anon not redirected:", p, r.status()); } } check(`anonymous: all ${pages.length} app pages redirect to login`, bad === 0); await ctx.close(); }

for (const [role, email] of ROLES) {
  const { ctx, page } = await login(email); const errors = []; page.on("pageerror", (e) => errors.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !noise.test(m.text())) errors.push(m.text()); });
  matrix[role] = {}; let s5 = 0;
  for (const p of pages) {
    const r = await page.goto(p, { waitUntil: "networkidle" }).catch(() => null); const st = r?.status() ?? 0; const path = new URL(page.url()).pathname;
    const outcome = st >= 500 || st === 0 ? "ERROR" : path === "/forbidden" ? "FORBIDDEN" : path !== p.split("?")[0] ? (path.endsWith("/login") ? "LOGIN" : `REDIRECT→${path}`) : st === 200 ? "OK" : String(st); matrix[role][p] = outcome; if (outcome === "ERROR") s5++;
  }
  check(`${role}: no 5xx on any of ${pages.length} pages`, s5 === 0); check(`${role}: no browser errors during sweep`, errors.length === 0, errors.slice(0, 2).join(" | ").slice(0, 200));
  const platformOk = pages.filter((p) => p.startsWith("/platform") && matrix[role][p] === "OK").length;
  if (role === "SUPER_ADMIN") check("SUPER_ADMIN reaches platform pages", platformOk >= 20, String(platformOk)); else check(`${role}: no /platform page is served`, platformOk === 0, String(platformOk));
  if (role !== "SUPER_ADMIN") { const clinicOnly = ["/settings/security", "/team"]; if (role !== "CLINIC_ADMIN") check(`${role}: cannot open Team management or security settings`, clinicOnly.every((p) => matrix[role][p] !== "OK")); }
  /* 3 — responsive (first role pass only for admin; others use dashboard) */
  if (role === "CLINIC_ADMIN" || role === "SUPER_ADMIN") {
    const keys = role === "SUPER_ADMIN" ? ["/platform", "/platform/clinics", "/platform/system", "/platform/security"] : ["/dashboard", "/patients", "/opd", "/appointments", "/billing", "/pharmacy/stock", "/lab", "/settings", "/analytics"];
    for (const w of [375, 768, 1280]) { await page.setViewportSize({ width: w, height: 800 }); const over = []; for (const p of keys) { await page.goto(p, { waitUntil: "networkidle" }).catch(() => {}); const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); if (o > 1) over.push(`${p}(+${o})`); } check(`${role}: no horizontal page overflow at ${w}px`, over.length === 0, over.join(" ")); resp[`${role}@${w}`] = over; }
    await page.setViewportSize({ width: 1280, height: 800 });
    /* 2 — a11y */
    for (const p of keys) { await page.goto(p, { waitUntil: "networkidle" }).catch(() => {}); await page.evaluate(AXE); const res = await page.evaluate(async () => { const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help })); }); axeOut[`${role}:${p}`] = res; const crit = res.filter((v) => v.impact === "critical" || v.impact === "serious"); check(`a11y ${role} ${p}: no critical/serious axe violations`, crit.length === 0, crit.map((v) => `${v.id}×${v.n}`).join(",")); }
  }
  await ctx.close();
}
/* public + portal */
{ const ctx = await browser.newContext({ baseURL: BASE }); const page = await ctx.newPage(); for (const p of ["/login", "/forgot-password", "/portal/login", "/portal/register", "/pricing"]) { await page.goto(p, { waitUntil: "networkidle" }).catch(() => {}); await page.evaluate(AXE); const res = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length }))); axeOut[`public:${p}`] = res; const crit = res.filter((v) => v.impact === "critical" || v.impact === "serious"); check(`a11y public ${p}: no critical/serious violations`, crit.length === 0, crit.map((v) => `${v.id}×${v.n}`).join(",")); for (const w of [375, 768]) { await page.setViewportSize({ width: w, height: 800 }); const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check(`public ${p}: no overflow at ${w}px`, o <= 1, String(o)); } await page.setViewportSize({ width: 1280, height: 800 }); } await ctx.close(); }
/* patient portal role */
{ const { ctx, page } = await login("patient@demo.mecgura.test", "/portal/login").catch((e) => { console.log("   patient login:", String(e).slice(0, 120)); return { ctx: null, page: null }; }); if (page) { await page.goto("/dashboard", { waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle").catch(() => {}); check("PATIENT cannot open the staff dashboard", new URL(page.url()).pathname !== "/dashboard"); await page.goto("/platform", { waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle").catch(() => {}); check("PATIENT cannot open /platform", new URL(page.url()).pathname !== "/platform"); for (const w of [375, 768]) { await page.setViewportSize({ width: w, height: 800 }); for (const p of ["/portal", "/portal/appointments", "/portal/billing"]) { await page.goto(p, { waitUntil: "networkidle" }).catch(() => {}); const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check(`portal ${p} no overflow at ${w}px`, o <= 1, String(o)); } } await ctx.close(); } else check("patient login for QA", false); }
writeFileSync(process.env.QA_OUT ?? "qa-results.json", JSON.stringify({ matrix, axe: axeOut, overflow: resp }, null, 1));
await browser.close(); console.log(`Phase 18 QA: ${pass} passed, ${fails.length} failed`); process.exit(fails.length ? 1 : 0);
