/**
 * End-to-end security checks against a RUNNING dev server (real HTTP, real cookies, real sessions).
 *   npm run dev            (with `npm run db:seed` done and TENANT_ROOT_DOMAIN="mecgura.test" in .env)
 *   node e2e/phase1-security.mjs
 * Needs `playwright-core` + a Chromium (set CHROMIUM_PATH). Not part of `npm test` (needs a live server).
 */
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PORT = new URL(BASE).port || "3000";
const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "Demo-Local-Pass-1";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--host-resolver-rules=MAP *.mecgura.test 127.0.0.1"],
});

let pass = 0; const fails = [];
const check = (name, ok, extra = "") => { if (ok) pass++; else { fails.push(name); console.log("  ✗", name, extra); } };

async function login(identifier, { base = BASE, password = PASSWORD } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/login`);
  await page.fill("input[name=identifier]", identifier);
  await page.fill("input[name=password]", password);
  await page.click("button[type=submit]");
  const ok = await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }).then(() => true),
    page.waitForSelector("form [role=alert]", { timeout: 15000 }).then(() => false),
  ]).catch(() => false);
  return { ctx, page, ok };
}
const seen = (loc) => loc.first().waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);
const urlHas = (page, part) => page.waitForURL((u) => u.href.includes(part), { timeout: 8000 }).then(() => true, () => false);
const api = async (c, method, path, body, base = BASE) => {
  const res = await c.ctx.request.fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", origin: base }, data: body ? JSON.stringify(body) : undefined, failOnStatusCode: false, maxRedirects: 0 });
  let json = null; try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status(), json };
};

// ---------------- Unauthenticated ----------------
{
  const anon = { ctx: await browser.newContext() };
  for (const p of ["/api/users", "/api/clinic", "/api/platform/clinics", "/api/me"]) check(`anon GET ${p} -> 401`, (await api(anon, "GET", p)).status === 401);
  check("anon POST /api/platform/clinics -> 401", (await api(anon, "POST", "/api/platform/clinics", {})).status === 401);
  const r = await anon.ctx.request.get(`${BASE}/dashboard`, { maxRedirects: 0, failOnStatusCode: false });
  check("anon /dashboard redirects to /login", r.status() === 307 && (r.headers().location ?? "").includes("/login"));
  const bad = await anon.ctx.request.post(`${BASE}/api/invitations/accept`, { data: { token: "x".repeat(43), password: "Strong-pass-12345", confirm: "Strong-pass-12345" }, headers: { origin: BASE }, failOnStatusCode: false });
  check("bogus invitation token -> 400 generic", bad.status() === 400);
}

// ---------------- Super Admin: clinic lifecycle ----------------
const sa = await login("platform@demo.mecgura.test");
check("super admin signs in", sa.ok);
await sa.page.goto(`${BASE}/dashboard`);
check("super admin dashboard shows platform overview", await seen(sa.page.getByText("MECGURA HEALTH platform overview")));
await sa.page.goto(`${BASE}/team`);
check("super admin outside a clinic is sent away from /team", await urlHas(sa.page, "/platform/clinics"));
const suffix = Date.now().toString(36);

const created = await api(sa, "POST", "/api/platform/clinics", {
  profile: { name: `E2E Clinic ${suffix}`, clinicType: "INDIVIDUAL_DOCTOR", timezone: "Asia/Kolkata", country: "India" },
  slug: `e2e-${suffix}`, status: "ACTIVE",
  branding: { primaryColor: "#0f766e", secondaryColor: "#1d4ed8", accentColor: "#12a06a" },
  admin: { name: "E2E Admin", email: `e2e-${suffix}@e2e.test`, phone: `+919${(parseInt(suffix, 36) % 1e9).toString().padStart(9, "0")}`, role: "CLINIC_ADMIN" },
});
check("super admin creates a clinic", created.status === 200 && created.json?.ok, JSON.stringify(created.json));
const newId = created.json?.data?.tenant?.id; const token = created.json?.data?.inviteToken;
check("creation returns a one-time invitation token (no email claimed)", !!token);
const dupe = await api(sa, "POST", "/api/platform/clinics", { ...JSON.parse(JSON.stringify({ profile: { name: "x", clinicType: "OTHER", timezone: "Asia/Kolkata", country: "India" }, slug: `e2e-${suffix}`, branding: { primaryColor: "#0f766e", secondaryColor: "#1d4ed8", accentColor: "#12a06a" }, admin: { name: "A", email: `x-${suffix}@e2e.test`, role: "DOCTOR" } })) });
check("duplicate workspace address -> 409", dupe.status === 409);
const light = await api(sa, "POST", "/api/platform/clinics", { profile: { name: "L", clinicType: "OTHER", timezone: "Asia/Kolkata", country: "India" }, slug: `light-${suffix}`, branding: { primaryColor: "#ffff00", secondaryColor: "#1d4ed8", accentColor: "#12a06a" }, admin: { name: "A", email: `l-${suffix}@e2e.test`, role: "DOCTOR" } });
check("unreadable brand colour rejected server-side -> 400", light.status === 400 && !!light.json?.error?.fieldErrors?.["branding.primaryColor"]);

// invited admin accepts the invitation in the browser, then signs in by PHONE
const inv = await browser.newContext(); const ip = await inv.newPage();
await ip.goto(`${BASE}/invite/${token}`);
await ip.fill('input[autocomplete="new-password"] >> nth=0', "Strong-pass-12345");
await ip.fill('input[autocomplete="new-password"] >> nth=1', "Strong-pass-12345");
await ip.click("button[type=submit]");
check("invitation can be accepted once", await seen(ip.getByText("Account ready")));
await ip.goto(`${BASE}/invite/${token}`); await ip.fill('input[autocomplete="new-password"] >> nth=0', "Strong-pass-12345"); await ip.fill('input[autocomplete="new-password"] >> nth=1', "Strong-pass-12345"); await ip.click("button[type=submit]");
check("invitation cannot be reused", await seen(ip.getByRole("alert").filter({ hasText: "invalid or has expired" })));
await inv.close();
const adminPhone = `+919${(parseInt(suffix, 36) % 1e9).toString().padStart(9, "0")}`;
const byPhone = await login(adminPhone.slice(3), { password: "Strong-pass-12345" });
check("new clinic admin signs in with phone number", byPhone.ok);
check("…and lands in their own clinic workspace", (await seen(byPhone.page.getByText(`E2E Clinic ${suffix}`))));
await byPhone.ctx.close();

// enter / exit workspace
const enter = await api(sa, "POST", "/api/platform/workspace", { tenantId: newId });
check("super admin enters a clinic workspace", enter.status === 200);
await sa.page.goto(`${BASE}/team`);
check("'Viewing as Super Admin' banner shown", await seen(sa.page.getByText("Viewing as Super Admin")));
check("team lists that clinic's users", await seen(sa.page.getByText("E2E Admin")));
await api(sa, "DELETE", "/api/platform/workspace");
await sa.page.goto(`${BASE}/team`);
check("after exit, /team is no longer reachable", await urlHas(sa.page, "/platform/clinics"));
// forged workspace cookie
await sa.ctx.addCookies([{ name: "mh_workspace", value: `${newId}.forged`, url: BASE }]);
check("forged workspace cookie is ignored", (await api(sa, "GET", "/api/users")).status === 403);
await sa.ctx.clearCookies({ name: "mh_workspace" });

// ---------------- Tenant users ----------------
const adminA = await login("admin@demo.mecgura.test");
const docA = await login("doctor@demo.mecgura.test");
const recA = await login("reception@demo.mecgura.test");
const adminB = await login("admin@demob.mecgura.test");
check("seeded users sign in", adminA.ok && docA.ok && recA.ok && adminB.ok);

const usersA = await api(adminA, "GET", "/api/users"); const usersB = await api(adminB, "GET", "/api/users");
const idsA = new Set(usersA.json.data.rows.map((u) => u.id)); const idsB = usersB.json.data.rows.map((u) => u.id);
check("admin A sees only clinic A users", usersA.status === 200 && usersA.json.data.rows.every((u) => !u.email.includes("demob")));
check("admin B sees only clinic B users", usersB.json.data.rows.every((u) => u.email.includes("demob")));
check("no overlap between clinics", idsB.every((id) => !idsA.has(id)));
const foreign = idsB[0];
for (const [m, p, b] of [["GET", `/api/users/${foreign}`], ["PATCH", `/api/users/${foreign}`, { name: "hacked" }], ["POST", `/api/users/${foreign}/status`, { status: "DISABLED" }], ["POST", `/api/users/${foreign}/invite`]]) {
  check(`admin A ${m} ${p.replace(foreign, ":B-user")} -> 404 (resource hidden)`, (await api(adminA, m, p, b)).status === 404);
}
check("clinic B user unchanged", (await api(adminB, "GET", `/api/users/${foreign}`)).json.data.name !== "hacked");
// client-supplied tenantId is ignored
const evil = await api(adminA, "POST", "/api/users", { name: "Evil", email: `evil-${suffix}@e2e.test`, role: "STAFF", tenantId: "other", tenant: { id: "other" } });
check("create user ignores any client tenantId", evil.status === 200);
check("…and the user appears only in clinic A", (await api(adminB, "GET", `/api/users?q=evil-${suffix}`)).json.data.rows.length === 0 && (await api(adminA, "GET", `/api/users?q=evil-${suffix}`)).json.data.rows.length === 1);
const patchProfile = await api(adminA, "PATCH", "/api/clinic", { name: "Demo Clinic", clinicType: "MULTI_DOCTOR", timezone: "Asia/Kolkata", country: "India", id: "x", tenantId: "y" });
check("admin A edits only own clinic profile", patchProfile.status === 200 && (await api(adminB, "GET", "/api/clinic")).json.data.slug === "demo-clinic-b");
// platform APIs
for (const c of [adminA, docA, recA, adminB]) {
  check("tenant user GET /api/platform/clinics -> 403", (await api(c, "GET", "/api/platform/clinics")).status === 403);
}
check("clinic admin cannot suspend a clinic", (await api(adminA, "POST", `/api/platform/clinics/${newId}/status`, { status: "SUSPENDED" })).status === 403);
check("clinic admin cannot enter another clinic", (await api(adminA, "POST", "/api/platform/workspace", { tenantId: newId })).status === 403);
// doctor / receptionist
check("doctor GET /api/users -> 403", (await api(docA, "GET", "/api/users")).status === 403);
check("doctor POST /api/users -> 403", (await api(docA, "POST", "/api/users", { name: "x", email: `d-${suffix}@e2e.test`, role: "STAFF" })).status === 403);
check("doctor PATCH /api/clinic -> 403", (await api(docA, "PATCH", "/api/clinic", { name: "x", clinicType: "OTHER", timezone: "Asia/Kolkata", country: "India" })).status === 403);
check("receptionist PATCH /api/clinic/branding -> 403", (await api(recA, "PATCH", "/api/clinic/branding", { primaryColor: "#14529e", secondaryColor: "#0e7c86", accentColor: "#12a06a" })).status === 403);
check("doctor can read own clinic", (await api(docA, "GET", "/api/clinic")).status === 200);
await docA.page.goto(`${BASE}/team`); check("doctor /team page -> /forbidden", await urlHas(docA.page, "/forbidden"));
await recA.page.goto(`${BASE}/settings/branding`);
check("receptionist sees branding as view-only", await seen(recA.page.getByText("Only a Clinic Admin can change branding")));
await recA.page.goto(`${BASE}/platform/clinics`); check("receptionist /platform/clinics -> /forbidden", await urlHas(recA.page, "/forbidden"));
// assets
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const upB = await adminB.ctx.request.post(`${BASE}/api/users/${foreign}/avatar`, { multipart: { file: { name: "a.png", mimeType: "image/png", buffer: png } }, headers: { origin: BASE }, failOnStatusCode: false });
check("admin B uploads an avatar for own user", upB.status() === 200);
const assetUrl = (await api(adminB, "GET", `/api/users/${foreign}`)).json.data.avatarUrl;
check("admin B can load the avatar", (await adminB.ctx.request.get(`${BASE}${assetUrl}`)).status() === 200);
check("admin A gets 404 for B's avatar", (await adminA.ctx.request.get(`${BASE}${assetUrl}`, { failOnStatusCode: false })).status() === 404);
check("anonymous gets 404 for avatars", (await (await browser.newContext()).request.get(`${BASE}${assetUrl}`, { failOnStatusCode: false })).status() === 404);
const svg = await adminA.ctx.request.post(`${BASE}/api/clinic/branding/logo`, { multipart: { file: { name: "x.png", mimeType: "image/png", buffer: Buffer.from("<svg onload=alert(1)/>") } }, headers: { origin: BASE }, failOnStatusCode: false });
check("SVG disguised as PNG rejected", svg.status() === 400);

// ---------------- Suspended clinic / disabled user ----------------
check("suspend clinic B (super admin)", (await api(sa, "POST", `/api/platform/clinics/${(await api(adminB, "GET", "/api/clinic")).json.data.id}/status`, { status: "SUSPENDED" })).status === 200);
check("suspended clinic: existing session API -> 401", (await api(adminB, "GET", "/api/users")).status === 401);
await adminB.page.goto(`${BASE}/dashboard`);
check("suspended clinic: page redirects to login with notice", (await urlHas(adminB.page, "/login")) && (await seen(adminB.page.getByText("workspace is currently suspended"))));
const retry = await login("doctor@demob.mecgura.test"); check("suspended clinic: new sign-in refused", !retry.ok); await retry.ctx.close();
check("clinic A unaffected", (await api(adminA, "GET", "/api/users")).status === 200);
const bId = (await (await sa.ctx.request.get(`${BASE}/api/platform/clinics?q=demo-clinic-b`)).json()).data.rows[0].id;
check("re-activate clinic B", (await api(sa, "POST", `/api/platform/clinics/${bId}/status`, { status: "ACTIVE" })).status === 200);
const again = await login("doctor@demob.mecgura.test"); check("after re-activation B can sign in again", again.ok); await again.ctx.close();

const recId = (await api(adminA, "GET", "/api/users?q=reception@demo")).json.data.rows[0].id;
check("admin disables receptionist", (await api(adminA, "POST", `/api/users/${recId}/status`, { status: "DISABLED" })).status === 200);
check("disabled user's existing session -> 401", (await api(recA, "GET", "/api/me")).status === 401);
const dis = await login("reception@demo.mecgura.test"); check("disabled user cannot sign in", !dis.ok); await dis.ctx.close();
check("admin re-activates receptionist", (await api(adminA, "POST", `/api/users/${recId}/status`, { status: "ACTIVE" })).status === 200);
check("admin cannot disable self", (await api(adminA, "POST", `/api/users/${(await api(adminA, "GET", "/api/users?q=admin@demo.")).json.data.rows.find((u) => u.email === "admin@demo.mecgura.test").id}/status`, { status: "DISABLED" })).status === 403);

// ---------------- Host-based tenant resolution ----------------
const hostB = `http://demo-b.mecgura.test:${PORT}`;
const wrongHost = await login("admin@demo.mecgura.test", { base: hostB });
check("clinic A admin cannot sign in on clinic B's subdomain", !wrongHost.ok); 
const hp = wrongHost.page; await hp.goto(`${hostB}/login`);
check("clinic B subdomain login page is branded for clinic B", await seen(hp.getByText("Demo Clinic B")));
await wrongHost.ctx.close();
const rightHost = await login("admin@demob.mecgura.test", { base: hostB });
check("clinic B admin signs in on clinic B's subdomain", rightHost.ok);
const unknown = await browser.newContext(); const up = await unknown.newPage();
await up.goto(`http://nobody.mecgura.test:${PORT}/login`);
check("unknown subdomain shows the default (unbranded) login", (await seen(up.getByText("Welcome back"))) && (await up.getByText("Demo Clinic").count()) === 0);
await unknown.close();

console.log(`\n${pass} checks passed, ${fails.length} failed`);
if (fails.length) { console.log(fails.map((f) => " - " + f).join("\n")); }
await browser.close();
process.exit(fails.length ? 1 : 0);
